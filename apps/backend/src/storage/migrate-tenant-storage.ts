import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
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
import { DataSource } from 'typeorm';
import { parseStoragePublicBases, rewriteStorageUrls, type StorageDocumentValue } from './tenant-storage-url-rewrite';
import {
  parseStorageRewriteKeys,
  rewriteTenantJsonDocuments,
  storageSourceFingerprint,
  verifyMigratedStorageObject,
  type StorageDocumentMigrationIO,
  type StorageMigrationObject,
} from './tenant-storage-document-rewrite';

export { rewriteStorageUrls } from './tenant-storage-url-rewrite';
interface ContentColumn {
  table_name: string;
  column_name: string;
  udt_name: string;
}
interface ContentRow {
  id: string;
  value: StorageDocumentValue;
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const isMissing = (error: Error): boolean => error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;

export function storageMigrationObject(value: HeadObjectCommandOutput): StorageMigrationObject {
  if (value.ContentLength === undefined || !value.ETag) throw new Error('Missing object size or ETag');
  return {
    size: value.ContentLength,
    etag: value.ETag,
    metadata: value.Metadata ?? {},
    contentType: value.ContentType,
    contentDisposition: value.ContentDisposition,
    contentEncoding: value.ContentEncoding,
    contentLanguage: value.ContentLanguage,
  };
}

export function storageDocumentMigrationIO(s3: S3Client, bucket: string): StorageDocumentMigrationIO {
  return {
    head: async (key) => storageMigrationObject(await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))),
    read: async (key, etag) => {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }));
      if (!result.Body) throw new Error(`Object body unavailable: ${key}`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
    assertConditionalWrites: async (tenantId) => {
      const key = `tenants/${tenantId}/.nervion-migration-probes/${randomUUID()}`;
      try {
        // A normal PUT creates this random absent key. Only honored IfMatch can reject it.
        // Unsupported/ignored conditions must never reach a real document write.
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: Buffer.alloc(0),
          ACL: 'private',
          IfMatch: `"nervion-missing-${randomUUID()}"`,
          Metadata: { 'nervion-conditional-write-probe': tenantId },
        }));
      } catch (error) {
        if (error instanceof S3ServiceException && [404, 412].includes(error.$metadata.httpStatusCode ?? 0)) return;
        throw new Error('Storage did not confirm conditional PUT support; document rewrite stopped');
      }
      throw new Error(`Storage ignored IfMatch; document rewrite stopped. Isolated empty probe retained: ${key}`);
    },
    write: async (key, body, attributes, expectedEtag) => {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        IfMatch: expectedEtag,
        ACL: 'private',
        CacheControl: 'private, no-store',
        ContentType: attributes.contentType,
        ContentDisposition: attributes.contentDisposition,
        ContentEncoding: attributes.contentEncoding,
        ContentLanguage: attributes.contentLanguage,
        Metadata: attributes.metadata,
      }));
    },
  };
}

async function migrateUrls(tenantId: string, apply: boolean, keys: Set<string>): Promise<void> {
  const bases = parseStoragePublicBases(required('TENANCY_STORAGE_PUBLIC_BASE_URLS'));
  const database = new DataSource({
    type: 'postgres',
    host: required('MIGRATION_POSTGRES_HOST'),
    port: Number(process.env.MIGRATION_POSTGRES_PORT || 5432),
    username: required('MIGRATION_POSTGRES_USER'),
    password: required('MIGRATION_POSTGRES_PASSWORD'),
    database: required('POSTGRES_DB'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
  await database.initialize();
  try {
    await database.transaction(async (manager) => {
      if (!apply) await manager.query('SET TRANSACTION READ ONLY');
      await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await manager.query("SET LOCAL lock_timeout = '5s'");
      const columns: ContentColumn[] = await manager.query(`
        SELECT c.table_name, c.column_name, c.udt_name FROM information_schema.columns c
        WHERE c.table_schema='public' AND c.udt_name IN ('json', 'jsonb', 'text', 'varchar')
          AND (c.column_name IN ('photo_url', 'description', 'message', 'content', 'document', 'coverImage', 'cover_image')
            OR (c.table_name='mail_messages' AND c.column_name IN ('html_body', 'text_body')))
          AND EXISTS (SELECT 1 FROM information_schema.columns t WHERE t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.column_name='tenant_id')
          AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema=c.table_schema AND i.table_name=c.table_name AND i.column_name='id')
        ORDER BY c.table_name, c.column_name
      `);
      for (const column of columns) {
        const table = `public.${quote(column.table_name)}`;
        const field = quote(column.column_name);
        let cursor = '';
        let changed = 0;
        for (;;) {
          const rows: ContentRow[] = await manager.query(
            `SELECT id::text AS id, ${field} AS value FROM ${table} WHERE tenant_id=$1 AND id::text > $2 ORDER BY id::text LIMIT 250`,
            [tenantId, cursor],
          );
          if (!rows.length) break;
          for (const row of rows) {
            const rewritten = rewriteStorageUrls(row.value, bases, keys);
            if (JSON.stringify(row.value) === JSON.stringify(rewritten)) continue;
            changed++;
            if (apply) {
              const json = column.udt_name === 'json' || column.udt_name === 'jsonb';
              await manager.query(`UPDATE ${table} SET ${field}=$1 WHERE tenant_id=$2 AND id::text=$3`, [
                json ? JSON.stringify(rewritten) : rewritten,
                tenantId,
                row.id,
              ]);
            }
          }
          cursor = rows[rows.length - 1].id;
        }
        if (changed)
          process.stdout.write(
            JSON.stringify({
              operation: apply ? 'rewrite' : 'plan-rewrite',
              table: column.table_name,
              column: column.column_name,
              rows: changed,
            }) + '\n',
          );
      }
    });
  } finally {
    await database.destroy();
  }
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  if (
    [...flags].some((flag) => !['--apply', '--rewrite-urls', '--rewrite-documents', '--dry-run'].includes(flag)) ||
    (flags.has('--apply') && flags.has('--dry-run')) ||
    (flags.has('--rewrite-documents') && flags.has('--rewrite-urls'))
  ) {
    throw new Error('Usage: tenant:storage:migrate [--dry-run | --apply] [--rewrite-urls | --rewrite-documents]');
  }
  const apply = flags.has('--apply');
  const rewriteDocuments = flags.has('--rewrite-documents');
  const tenantId = required('TENANCY_BOOTSTRAP_TENANT_ID').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId))
    throw new Error('Invalid bootstrap tenant UUID');
  const prefixes = [
    ...new Set(
      required('TENANCY_STORAGE_SOURCE_PREFIXES')
        .split(',')
        .map((prefix) => prefix.trim()),
    ),
  ];
  if (
    prefixes.some(
      (prefix) =>
        !prefix ||
        !prefix.endsWith('/') ||
        prefix.startsWith('/') ||
        prefix.startsWith('tenants/') ||
        prefix.includes('..') ||
        prefix.includes('\\'),
    )
  ) {
    throw new Error('Explicit non-empty legacy prefixes ending in / are required; tenants/ is forbidden');
  }
  if (apply && process.env.TENANCY_STORAGE_WRITES_STOPPED !== 'true')
    throw new Error('Stop application writes, then set TENANCY_STORAGE_WRITES_STOPPED=true');
  const bucket = required('AWS_BUCKET_ID');
  const s3 = new S3Client({
    endpoint: required('AWS_ENDPOINT'),
    region: process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: required('AWS_ACCESS_KEY_ID'), secretAccessKey: required('AWS_SECRET_ACCESS_KEY') },
  });
  const documentIO = storageDocumentMigrationIO(s3, bucket);
  const copiedKeys = new Set<string>();
  try {
    for (const prefix of prefixes) {
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) {
          const sourceKey = object.Key;
          if (!sourceKey || copiedKeys.has(sourceKey)) continue;
          if (!sourceKey.startsWith(prefix) || sourceKey.startsWith('tenants/')) throw new Error('Unexpected source key');
          const targetKey = `tenants/${tenantId}/${sourceKey}`;
          const source = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
          if (source.ContentLength === undefined || !source.ETag) throw new Error(`Missing source metadata: ${sourceKey}`);
          const fingerprint = storageSourceFingerprint(sourceKey, storageMigrationObject(source));
          let target: HeadObjectCommandOutput | undefined;
          try {
            target = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: targetKey }));
          } catch (error) {
            if (!(error instanceof Error) || !isMissing(error)) throw error;
          }
          if (target) await verifyMigratedStorageObject(documentIO, tenantId, sourceKey, storageMigrationObject(source), storageMigrationObject(target));
          if (rewriteDocuments && !target) throw new Error(`Copy all selected objects before the document rewrite stage: ${sourceKey}`);
          process.stdout.write(
            JSON.stringify({
              operation: target ? 'verified-existing' : apply ? 'copy' : 'plan-copy',
              sourceKey,
              targetKey,
              size: source.ContentLength,
              etag: source.ETag,
            }) + '\n',
          );
          if (apply && !rewriteDocuments && !target) {
            const copySource = `${encodeURIComponent(bucket)}/${encodeKey(sourceKey)}${source.VersionId ? `?versionId=${encodeURIComponent(source.VersionId)}` : ''}`;
            const metadata = { ...source.Metadata, 'nervion-migration-source': fingerprint };
            const attributes = {
              ContentType: source.ContentType,
              ContentDisposition: source.ContentDisposition,
              ContentEncoding: source.ContentEncoding,
              ContentLanguage: source.ContentLanguage,
              CacheControl: 'private, no-store',
              Metadata: metadata,
              ACL: 'private' as const,
            };
            if (source.ContentLength <= 5 * 1024 ** 3) {
              await s3.send(
                new CopyObjectCommand({
                  Bucket: bucket,
                  Key: targetKey,
                  CopySource: copySource,
                  CopySourceIfMatch: source.ETag,
                  MetadataDirective: 'REPLACE',
                  ...attributes,
                }),
              );
            } else {
              const upload = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: targetKey, ...attributes }));
              if (!upload.UploadId) throw new Error('S3 returned no UploadId');
              try {
                const parts: CompletedPart[] = [];
                const partSize = Math.max(512 * 1024 ** 2, Math.ceil(source.ContentLength / 9999));
                for (let start = 0, number = 1; start < source.ContentLength; start += partSize, number++) {
                  const result = await s3.send(
                    new UploadPartCopyCommand({
                      Bucket: bucket,
                      Key: targetKey,
                      UploadId: upload.UploadId,
                      PartNumber: number,
                      CopySource: copySource,
                      CopySourceIfMatch: source.ETag,
                      CopySourceRange: `bytes=${start}-${Math.min(start + partSize, source.ContentLength) - 1}`,
                    }),
                  );
                  if (!result.CopyPartResult?.ETag) throw new Error('S3 returned no part ETag');
                  parts.push({ PartNumber: number, ETag: result.CopyPartResult.ETag });
                }
                await s3.send(
                  new CompleteMultipartUploadCommand({
                    Bucket: bucket,
                    Key: targetKey,
                    UploadId: upload.UploadId,
                    MultipartUpload: { Parts: parts },
                  }),
                );
              } catch (error) {
                await s3
                  .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: targetKey, UploadId: upload.UploadId }))
                  .catch(() => {});
                throw error;
              }
            }
            const verified = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: targetKey }));
            if (
              verified.ContentLength !== source.ContentLength ||
              verified.Metadata?.['nervion-migration-source'] !== fingerprint
            ) {
              throw new Error(`Copy verification failed: ${targetKey}`);
            }
          }
          copiedKeys.add(sourceKey);
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
    if (rewriteDocuments) {
      const keys = parseStorageRewriteKeys(required('TENANCY_STORAGE_REWRITE_KEYS_JSON'), copiedKeys);
      const bases = parseStoragePublicBases(required('TENANCY_STORAGE_PUBLIC_BASE_URLS'));
      const results = await rewriteTenantJsonDocuments(documentIO, tenantId, keys, bases, copiedKeys, apply);
      for (const result of results) process.stdout.write(JSON.stringify(result) + '\n');
    }
    if (flags.has('--rewrite-urls')) await migrateUrls(tenantId, apply, copiedKeys);
    process.stdout.write(
      JSON.stringify({ mode: apply ? 'applied' : 'dry-run', objects: copiedKeys.size, tenantId, originalsPreserved: true }) +
        '\n',
    );
  } finally {
    s3.destroy();
  }
}

if (require.main === module)
  void main().catch((error: Error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
