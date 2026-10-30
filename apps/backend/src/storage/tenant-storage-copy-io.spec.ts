import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCopyCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { listStorageSourceKeys, storageCopyRewriteIO, storageMigrationObject } from './tenant-storage-copy-io';
import { STORAGE_SOURCE_MARKER, storageSourceFingerprint } from './tenant-storage-document-rewrite';

const output = (body: string, etag = 'original'): HeadObjectCommandOutput => ({
  $metadata: {},
  ContentLength: Buffer.byteLength(body),
  ETag: etag,
  ContentType: 'application/json',
  Metadata: {},
});
const bodyOutput = (body: string, etag = 'original') => ({
  ...output(body, etag),
  Body: { transformToWebStream: () => Readable.toWeb(Readable.from([Buffer.from(body)])) },
});

describe('storage copy migration S3 adapter', () => {
  const send = jest.fn<
    Promise<object>,
    [
      (
        | GetObjectCommand
        | ListObjectsV2Command
        | PutObjectCommand
        | CopyObjectCommand
        | CreateMultipartUploadCommand
        | UploadPartCopyCommand
        | CompleteMultipartUploadCommand
        | AbortMultipartUploadCommand
      ),
      object?,
    ]
  >();
  const s3 = { send } as Partial<S3Client> as S3Client;
  const guard = jest.fn(async () => {});
  beforeEach(() => {
    send.mockReset();
    guard.mockClear();
  });

  it('collects the complete unique manifest across pages before resolving heads', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'old/a.json' }], IsTruncated: true, NextContinuationToken: 'next' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'old/b.bin' }, { Key: 'old/a.json' }], IsTruncated: false });
    expect(await listStorageSourceKeys(s3, 'bucket', ['old/'])).toEqual(['old/a.json', 'old/b.bin']);
    expect(send.mock.calls[1][0]).toBeInstanceOf(ListObjectsV2Command);
    expect((send.mock.calls[1][0] as ListObjectsV2Command).input.ContinuationToken).toBe('next');
  });

  it.each([undefined, 'same'])('fails closed on missing or repeating pagination %s', async (token) => {
    send.mockResolvedValue({ Contents: [], IsTruncated: true, NextContinuationToken: token });
    await expect(listStorageSourceKeys(s3, 'bucket', ['old/'])).rejects.toThrow('pagination');
  });

  it('rejects keys outside an explicitly selected source prefix', async () => {
    send.mockResolvedValue({ Contents: [{ Key: 'tenants/foreign/object' }] });
    await expect(listStorageSourceKeys(s3, 'bucket', ['old/'])).rejects.toThrow('Unexpected source');
  });

  it('detects a provider ignoring source IfMatch using returned metadata', async () => {
    send.mockResolvedValue(bodyOutput('{}', 'changed'));
    const io = storageCopyRewriteIO(s3, 'bucket', ['old/'], guard);
    await expect(io.read('old/a.json', storageMigrationObject(output('{}')), 16)).rejects.toThrow('GET representation');
    const command = send.mock.calls[0][0] as GetObjectCommand;
    expect(command.input.IfMatch).toBe('original');
  });

  it('detects metadata-only source changes even with the same ETag and bytes', async () => {
    send.mockResolvedValue({ ...bodyOutput('{}'), Metadata: { changed: 'yes' } });
    await expect(
      storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).digest('old/a.json', storageMigrationObject(output('{}'))),
    ).rejects.toThrow('GET representation');
  });

  it.each(['a', 'abc'])('rejects a stream with incorrect actual length %s', async (actual) => {
    send.mockResolvedValue({ ...bodyOutput(actual), ContentLength: 2 });
    await expect(
      storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).read('old/a.json', storageMigrationObject(output('{}')), 16),
    ).rejects.toThrow('snapshot size');
  });

  it('hashes streamed object bytes and requests the manifest version', async () => {
    send.mockResolvedValue({ ...bodyOutput('binary payload'), VersionId: 'version-1' });
    const snapshot = storageMigrationObject({ ...output('binary payload'), VersionId: 'version-1' });
    expect(await storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).digest('old/file', snapshot)).toBe(
      createHash('sha256').update('binary payload').digest('hex'),
    );
    expect((send.mock.calls[0][0] as GetObjectCommand).input.VersionId).toBe('version-1');
  });

  it('rejects an oversized buffered read before any GET', async () => {
    await expect(
      storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).read('old/file', storageMigrationObject(output('12345')), 4),
    ).rejects.toThrow('read budget');
    expect(send).not.toHaveBeenCalled();
  });

  it('creates final document bytes only after the writer guard, with a defense-in-depth create condition', async () => {
    send.mockResolvedValue({});
    const io = storageCopyRewriteIO(s3, 'bucket', ['old/'], guard);
    const body = Buffer.from('{}');
    await io.createDocument('tenants/id/old/a.json', body, storageMigrationObject(output('{}')));
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Body: body, IfNoneMatch: '*', ACL: 'private', CacheControl: 'private, no-store' });
  });

  it('never writes if the session lock guard fails', async () => {
    const io = storageCopyRewriteIO(s3, 'bucket', ['old/'], () => Promise.reject(new Error('lost lock')));
    await expect(io.createDocument('target', Buffer.from('{}'), storageMigrationObject(output('{}')))).rejects.toThrow(
      'lost lock',
    );
    await expect(io.copy('old/file', 'target', storageMigrationObject(output('{}')))).rejects.toThrow('lost lock');
    expect(send).not.toHaveBeenCalled();
  });

  it('copies binaries server-side with source identity and private attributes', async () => {
    send.mockResolvedValue({});
    const source = storageMigrationObject({ ...output('binary'), VersionId: 'v/1' });
    await storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).copy('old/file name', 'target', source);
    const command = send.mock.calls[0][0] as CopyObjectCommand;
    expect(command).toBeInstanceOf(CopyObjectCommand);
    expect(command.input).toMatchObject({
      CopySource: 'bucket/old/file%20name?versionId=v%2F1',
      CopySourceIfMatch: source.etag,
      ACL: 'private',
      MetadataDirective: 'REPLACE',
      Metadata: { [STORAGE_SOURCE_MARKER]: storageSourceFingerprint('old/file name', source) },
    });
  });

  it('copies large objects in ordered bounded parts, guarding every part and completion', async () => {
    send.mockImplementation((command) => {
      if (command instanceof CreateMultipartUploadCommand) return Promise.resolve({ UploadId: 'our-upload' });
      if (command instanceof UploadPartCopyCommand)
        return Promise.resolve({ CopyPartResult: { ETag: `part-${command.input.PartNumber}` } });
      return Promise.resolve({});
    });
    const source = { ...storageMigrationObject(output('binary')), size: 5 * 1024 ** 3 + 1 };
    await storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).copy('old/large', 'target', source);
    const parts = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is UploadPartCopyCommand => command instanceof UploadPartCopyCommand);
    expect(parts).toHaveLength(11);
    expect(parts[0].input).toMatchObject({
      CopySourceRange: 'bytes=0-536870911',
      CopySourceIfMatch: source.etag,
      UploadId: 'our-upload',
    });
    expect(parts.at(-1)?.input.CopySourceRange).toBe(`bytes=${5 * 1024 ** 3}-${5 * 1024 ** 3}`);
    expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(guard).toHaveBeenCalledTimes(13);
  });

  it('aborts only its own incomplete multipart upload after failure, never deleting an object', async () => {
    send.mockImplementation((command) => {
      if (command instanceof CreateMultipartUploadCommand) return Promise.resolve({ UploadId: 'our-upload' });
      if (command instanceof UploadPartCopyCommand) return Promise.reject(new Error('part failed'));
      return Promise.resolve({});
    });
    const source = { ...storageMigrationObject(output('binary')), size: 5 * 1024 ** 3 + 1 };
    await expect(storageCopyRewriteIO(s3, 'bucket', ['old/'], guard).copy('old/large', 'target', source)).rejects.toThrow(
      'part failed',
    );
    const abort = send.mock.calls.at(-1)?.[0] as AbortMultipartUploadCommand;
    expect(abort).toBeInstanceOf(AbortMultipartUploadCommand);
    expect(abort.input).toMatchObject({ Bucket: 'bucket', Key: 'target', UploadId: 'our-upload' });
    expect(send.mock.calls.some(([command]) => command instanceof CompleteMultipartUploadCommand)).toBe(false);
  });
});
