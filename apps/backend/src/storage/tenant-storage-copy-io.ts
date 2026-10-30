import { createHash } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCopyCommand,
  type CompletedPart,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import {
  MAX_STORAGE_MANIFEST_OBJECTS,
  sameStorageSnapshot,
  type StorageCopyManifestEntry,
  type StorageCopyRewriteIO,
} from './tenant-storage-copy-rewrite';
import { STORAGE_SOURCE_MARKER, storageSourceFingerprint, type StorageMigrationObject } from './tenant-storage-document-rewrite';
import { runStorageMigrationPage } from './tenant-storage-migration-concurrency';

const REQUEST_TIMEOUT_MS = 5 * 60_000;
const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

export function storageMigrationObject(value: HeadObjectCommandOutput): StorageMigrationObject {
  if (!Number.isSafeInteger(value.ContentLength) || value.ContentLength! < 0 || !value.ETag)
    throw new Error('Missing or invalid object size or ETag');
  return {
    size: value.ContentLength!,
    etag: value.ETag,
    versionId: value.VersionId,
    metadata: value.Metadata ?? {},
    contentType: value.ContentType,
    contentDisposition: value.ContentDisposition,
    contentEncoding: value.ContentEncoding,
    contentLanguage: value.ContentLanguage,
  };
}

export async function listStorageSourceKeys(s3: S3Client, bucket: string, prefixes: readonly string[]): Promise<string[]> {
  const keys = new Set<string>();
  for (const prefix of prefixes) {
    let token: string | undefined;
    let pages = 0;
    const tokens = new Set<string>();
    do {
      if (++pages > 1000) throw new Error('Storage manifest exceeds its pagination budget');
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      for (const { Key } of page.Contents ?? []) {
        if (!Key || !Key.startsWith(prefix) || Key.startsWith('tenants/')) throw new Error('Unexpected source key in manifest');
        keys.add(Key);
        if (keys.size > MAX_STORAGE_MANIFEST_OBJECTS) throw new Error('Storage manifest exceeds its object budget');
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && (!token || tokens.has(token))) throw new Error('Incomplete or repeating source pagination');
      if (token) tokens.add(token);
    } while (token);
  }
  return [...keys].sort();
}

export async function collectStorageCopyManifest(
  io: StorageCopyRewriteIO,
  concurrency: number,
): Promise<StorageCopyManifestEntry[]> {
  const keys = await io.sourceKeys();
  const entries = new Array<StorageCopyManifestEntry>(keys.length);
  await runStorageMigrationPage(
    keys.map((key, index) => ({ key, index })),
    concurrency,
    async ({ key, index }) => {
      const source = await io.head(key);
      if (!source) throw new Error('Source disappeared while collecting manifest');
      entries[index] = { key, source };
    },
  );
  return entries;
}

export function storageCopyRewriteIO(
  s3: S3Client,
  bucket: string,
  prefixes: readonly string[],
  assertWriter: () => Promise<void>,
): StorageCopyRewriteIO {
  const stream = async (
    key: string,
    snapshot: StorageMigrationObject,
    limit: number,
    consume: (chunk: Uint8Array) => void,
  ): Promise<void> => {
    if (snapshot.size > limit) throw new Error('Object exceeds the read budget');
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: snapshot.etag, VersionId: snapshot.versionId }),
      { abortSignal: signal },
    );
    const bodyStream = result.Body?.transformToWebStream() as ReadableStream<Uint8Array> | undefined;
    const reader = bodyStream?.getReader();
    if (!reader) throw new Error('Object body unavailable');
    const abort = (): void => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    let complete = false;
    try {
      signal.throwIfAborted();
      // Do not assume that the provider honored IfMatch. Verify the returned
      // representation and count bytes while streaming, without buffering files.
      if (!sameStorageSnapshot(snapshot, storageMigrationObject(result)))
        throw new Error('GET representation differs from its manifest snapshot');
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit || bytes > snapshot.size) throw new Error('Object stream exceeds its snapshot size');
        consume(chunk.value);
      }
      if (bytes !== snapshot.size) throw new Error('Object stream is shorter than its snapshot size');
      signal.throwIfAborted();
      complete = true;
    } finally {
      signal.removeEventListener('abort', abort);
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  return {
    head: async (key) => {
      try {
        return storageMigrationObject(
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        );
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return undefined;
        throw error;
      }
    },
    read: async (key, source, limit) => {
      const chunks: Buffer[] = [];
      await stream(key, source, limit, (chunk) => chunks.push(Buffer.from(chunk)));
      return Buffer.concat(chunks);
    },
    digest: async (key, source) => {
      const hash = createHash('sha256');
      await stream(key, source, source.size, (chunk) => {
        hash.update(chunk);
      });
      return hash.digest('hex');
    },
    createDocument: async (key, body, attributes) => {
      await assertWriter();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          IfNoneMatch: '*',
          ACL: 'private',
          CacheControl: 'private, no-store',
          ContentType: attributes.contentType,
          ContentDisposition: attributes.contentDisposition,
          ContentEncoding: attributes.contentEncoding,
          ContentLanguage: attributes.contentLanguage,
          Metadata: attributes.metadata,
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    },
    copy: async (sourceKey, targetKey, source) => {
      await assertWriter();
      const copySource = `${encodeURIComponent(bucket)}/${encodeKey(sourceKey)}${source.versionId ? `?versionId=${encodeURIComponent(source.versionId)}` : ''}`;
      const attributes = {
        ContentType: source.contentType,
        ContentDisposition: source.contentDisposition,
        ContentEncoding: source.contentEncoding,
        ContentLanguage: source.contentLanguage,
        CacheControl: 'private, no-store',
        ACL: 'private' as const,
        Metadata: { ...source.metadata, [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source) },
      };
      if (source.size <= 5 * 1024 ** 3) {
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: targetKey,
            CopySource: copySource,
            CopySourceIfMatch: source.etag,
            MetadataDirective: 'REPLACE',
            ...attributes,
          }),
          { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        return;
      }
      const upload = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: targetKey, ...attributes }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!upload.UploadId) throw new Error('S3 returned no UploadId');
      try {
        const parts: CompletedPart[] = [];
        const partSize = Math.max(512 * 1024 ** 2, Math.ceil(source.size / 9999));
        for (let start = 0, number = 1; start < source.size; start += partSize, number++) {
          await assertWriter();
          const result = await s3.send(
            new UploadPartCopyCommand({
              Bucket: bucket,
              Key: targetKey,
              UploadId: upload.UploadId,
              PartNumber: number,
              CopySource: copySource,
              CopySourceIfMatch: source.etag,
              CopySourceRange: `bytes=${start}-${Math.min(start + partSize, source.size) - 1}`,
            }),
            { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
          );
          if (!result.CopyPartResult?.ETag) throw new Error('S3 returned no part ETag');
          parts.push({ PartNumber: number, ETag: result.CopyPartResult.ETag });
        }
        await assertWriter();
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: targetKey,
            UploadId: upload.UploadId,
            MultipartUpload: { Parts: parts },
          }),
          { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
      } catch (error) {
        // Only abort the upload created by this invocation, never a user object.
        await s3
          .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: targetKey, UploadId: upload.UploadId }), {
            abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
          .catch(() => {});
        throw error;
      }
    },
    sourceKeys: () => listStorageSourceKeys(s3, bucket, prefixes),
    assertWriter,
  };
}
