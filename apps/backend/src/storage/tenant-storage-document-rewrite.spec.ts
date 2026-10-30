import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { storageDocumentMigrationIO } from './migrate-tenant-storage';
import {
  parseStorageRewriteKeys,
  rewriteTenantJsonDocuments,
  STORAGE_REWRITE_MARKER,
  STORAGE_SOURCE_MARKER,
  storageSourceFingerprint,
  StorageDocumentRewriteOperation,
  verifyMigratedStorageObject,
  type StorageDocumentMigrationIO,
  type StorageMigrationObject,
} from './tenant-storage-document-rewrite';

const tenantId = '11111111-1111-4111-8111-111111111111';
const sourceKey = 'tracker-project-wiki/1/document.json';
const imageKey = 'tracker-avatars/a.png';
const targetKey = `tenants/${tenantId}/${sourceKey}`;
const bases = [new URL('https://files.example.com/bucket/')];
const keys = new Set([sourceKey, imageKey]);
const digest = (body: Buffer) => createHash('sha256').update(body).digest('hex');

interface MemoryObject {
  body: Buffer;
  attributes: StorageMigrationObject;
}

function fixture() {
  const original = Buffer.from('{ "image": "https://files.example.com/bucket/tracker-avatars/a.png" }');
  const source: StorageMigrationObject = {
    size: original.length, etag: '"original"', metadata: {}, contentType: 'application/json',
  };
  const objects = new Map<string, MemoryObject>([
    [sourceKey, { body: original, attributes: source }],
    [targetKey, { body: Buffer.from(original), attributes: {
      ...source, metadata: { [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source) },
    } }],
  ]);
  const object = (key: string): MemoryObject => {
    const result = objects.get(key);
    if (!result) throw new Error('Object missing');
    return result;
  };
  const io: StorageDocumentMigrationIO = {
    head: jest.fn(async (key: string) => ({ ...object(key).attributes, metadata: { ...object(key).attributes.metadata } })),
    read: jest.fn(async (key: string, etag: string) => {
      const value = object(key);
      if (value.attributes.etag !== etag) throw new Error('Precondition failed');
      return Buffer.from(value.body);
    }),
    assertConditionalWrites: jest.fn(async () => {}),
    write: jest.fn(async (key: string, body: Buffer, attributes: StorageMigrationObject, expectedEtag: string) => {
      if (object(key).attributes.etag !== expectedEtag) throw new Error('Precondition failed');
      objects.set(key, { body: Buffer.from(body), attributes: { ...attributes, etag: `"${digest(body)}"` } });
    }),
  };
  return { original, source, io, objects, object };
}

describe('explicit tenant JSON document migration', () => {
  it('plans without writing objects or probing PUT support', async () => {
    const f = fixture();
    const plan = await rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, false);
    expect(plan[0].operation).toBe(StorageDocumentRewriteOperation.PLAN);
    expect(f.io.write).not.toHaveBeenCalled();
    expect(f.io.assertConditionalWrites).not.toHaveBeenCalled();
    expect(f.object(targetKey).body).toEqual(f.original);
    expect(f.object(sourceKey).body).toEqual(f.original);
  });

  it('rewrites only the tenant copy, verifies bytes and safely resumes both stages', async () => {
    const f = fixture();
    const result = await rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true);
    expect(result[0].operation).toBe(StorageDocumentRewriteOperation.REWRITE);
    expect(f.io.assertConditionalWrites).toHaveBeenCalledWith(tenantId);
    expect(f.io.write).toHaveBeenCalledWith(targetKey, expect.any(Buffer), expect.any(Object), '"original"');
    expect(f.object(sourceKey).body).toEqual(f.original);
    expect(f.object(targetKey).body.toString()).toContain('/api/files/raw?key=tracker-avatars%2Fa.png');
    await verifyMigratedStorageObject(f.io, tenantId, sourceKey, f.source, f.object(targetKey).attributes);
    const resumed = await rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true);
    expect(resumed[0].operation).toBe(StorageDocumentRewriteOperation.VERIFIED);
    expect(f.io.write).toHaveBeenCalledTimes(1);
  });

  it('preserves a UTF-8 BOM when a document has no links to rewrite', async () => {
    const f = fixture();
    const original = Buffer.from('\uFEFF{ "value": 9007199254740993 }');
    const source = { ...f.source, size: original.length };
    f.objects.set(sourceKey, { body: original, attributes: source });
    f.objects.set(targetKey, { body: Buffer.from(original), attributes: {
      ...source, metadata: { [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source) },
    } });
    const result = await rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true);
    expect(result[0].operation).toBe(StorageDocumentRewriteOperation.UNCHANGED);
    expect(f.io.write).not.toHaveBeenCalled();
    expect(f.object(targetKey).body).toEqual(original);
  });

  it('rejects missing copies, foreign keys and a changed source before any writes', async () => {
    for (const change of ['missing', 'source-changed', 'foreign'] as const) {
      const f = fixture();
      if (change === 'missing') f.objects.delete(targetKey);
      if (change === 'source-changed') f.source.etag = '"changed-source"';
      const selected = change === 'foreign' ? ['other-client/document.json'] : [sourceKey];
      await expect(rewriteTenantJsonDocuments(f.io, tenantId, selected, bases, keys, true)).rejects.toThrow();
      expect(f.io.write).not.toHaveBeenCalled();
    }
    expect(() => parseStorageRewriteKeys('["other-client/document.json"]', keys)).toThrow();
    expect(() => parseStorageRewriteKeys('[]', keys)).toThrow();
    expect(parseStorageRewriteKeys(JSON.stringify([sourceKey, sourceKey]), keys)).toEqual([sourceKey]);
  });

  it('requires authentic source, tenant, original size and actual rewritten SHA256 on rerun', async () => {
    for (const field of ['source', 'tenant', 'size', 'sha', 'body'] as const) {
      const f = fixture();
      await rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true);
      const target = f.object(targetKey);
      if (field === 'source') target.attributes.metadata[STORAGE_SOURCE_MARKER] = '0'.repeat(64);
      if (field === 'tenant') target.attributes.metadata['nervion-migration-tenant'] = '22222222-2222-4222-8222-222222222222';
      if (field === 'size') target.attributes.metadata['nervion-migration-source-size'] = '0';
      if (field === 'sha') target.attributes.metadata[STORAGE_REWRITE_MARKER] = '0'.repeat(64);
      if (field === 'body') target.body[0] = 32;
      await expect(verifyMigratedStorageObject(f.io, tenantId, sourceKey, f.source, target.attributes)).rejects.toThrow();
      expect(f.io.write).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses concurrent edits using the planned destination ETag', async () => {
    const f = fixture();
    f.io.assertConditionalWrites = jest.fn(async () => {
      f.object(targetKey).attributes.etag = '"concurrent-edit"';
      f.object(targetKey).body = Buffer.from('user edit');
    });
    await expect(rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true)).rejects.toThrow('Precondition failed');
    expect(f.object(targetKey).body.toString()).toBe('user edit');
    expect(f.object(sourceKey).body).toEqual(f.original);
  });

  it('fails closed before document writes when conditional PUT cannot be confirmed', async () => {
    const f = fixture();
    f.io.assertConditionalWrites = jest.fn(async () => { throw new Error('Unsupported IfMatch'); });
    await expect(rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey], bases, keys, true)).rejects.toThrow('Unsupported IfMatch');
    expect(f.io.write).not.toHaveBeenCalled();
    expect(f.object(targetKey).body).toEqual(f.original);
  });

  it('validates all explicit documents before writing the first one', async () => {
    const f = fixture();
    const second = 'tracker-project-wiki/1/broken.json';
    const body = Buffer.from('not JSON');
    const source = { size: body.length, etag: '"broken"', metadata: {} };
    f.objects.set(second, { body, attributes: source });
    f.objects.set(`tenants/${tenantId}/${second}`, { body, attributes: {
      ...source, metadata: { [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(second, source) },
    } });
    await expect(rewriteTenantJsonDocuments(f.io, tenantId, [sourceKey, second], bases, new Set([...keys, second]), true)).rejects.toThrow();
    expect(f.io.write).not.toHaveBeenCalled();
  });
});

describe('S3 conditional-write adapter', () => {
  const serviceError = (status: number) => new S3ServiceException({
    name: 'ConditionalWrite', $fault: 'client', $metadata: { httpStatusCode: status }, message: 'test',
  });

  it('serializes IfMatch in the installed SDK for both probe and document PUT', async () => {
    const headers: Record<string, string>[] = [];
    const s3 = new S3Client({
      region: 'us-east-1', endpoint: 'https://storage.example.test', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      requestHandler: {
        handle: async (request: { headers: Record<string, string> }) => {
          headers.push(request.headers);
          return { response: {
            statusCode: headers.length === 1 ? 412 : 200,
            headers: { 'content-type': 'application/xml' },
            body: Buffer.from(headers.length === 1 ? '<Error><Code>PreconditionFailed</Code></Error>' : ''),
          } };
        },
      },
    });
    try {
      const adapter = storageDocumentMigrationIO(s3, 'bucket');
      await adapter.assertConditionalWrites(tenantId);
      await adapter.write(targetKey, Buffer.from('{}'), { size: 2, etag: '"planned"', metadata: {} }, '"planned"');
      expect(headers[0]['if-match']).toMatch(/^"nervion-missing-/);
      expect(headers[1]['if-match']).toBe('"planned"');
    } finally {
      s3.destroy();
    }
  });

  it.each([404, 412])('accepts only a rejected probe (%i) and includes SDK IfMatch', async (status) => {
    const s3 = new S3Client({ region: 'test' });
    const send = jest.spyOn(s3, 'send').mockImplementation(async () => { throw serviceError(status); });
    await storageDocumentMigrationIO(s3, 'bucket').assertConditionalWrites(tenantId);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.IfMatch).toMatch(/^"nervion-missing-/);
    expect(command.input.Key).toMatch(new RegExp(`^tenants/${tenantId}/\\.nervion-migration-probes/`));
    expect(command.input.Body).toEqual(Buffer.alloc(0));
    s3.destroy();
  });

  it('refuses a provider that silently ignores IfMatch or rejects the feature', async () => {
    for (const accepted of [true, false]) {
      const s3 = new S3Client({ region: 'test' });
      const send = jest.spyOn(s3, 'send');
      if (accepted) send.mockImplementation(async () => ({}));
      else send.mockImplementation(async () => { throw serviceError(501); });
      await expect(storageDocumentMigrationIO(s3, 'bucket').assertConditionalWrites(tenantId)).rejects.toThrow(/stopped/);
      expect(send).toHaveBeenCalledTimes(1);
      s3.destroy();
    }
  });
});
