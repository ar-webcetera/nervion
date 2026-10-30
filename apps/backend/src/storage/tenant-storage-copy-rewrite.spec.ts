import { createHash } from 'node:crypto';
import { copyWithDocumentRewrite, StorageCopyManifestEntry, StorageCopyRewriteIO } from './tenant-storage-copy-rewrite';
import { StorageCopyRewriteOperation } from './tenant-storage-copy-rewrite.enums';
import {
  STORAGE_REWRITE_MARKER,
  STORAGE_SOURCE_MARKER,
  StorageMigrationObject,
  storageSourceFingerprint,
} from './tenant-storage-document-rewrite';

const tenantId = '11111111-1111-4111-8111-111111111111';
const bases = [new URL('https://storage.example.test/bucket/')];
const targetKey = (key: string) => `tenants/${tenantId}/${key}`;
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const clone = (value: StorageMigrationObject): StorageMigrationObject => ({ ...value, metadata: { ...value.metadata } });

interface StoredObject {
  body: Buffer;
  snapshot: StorageMigrationObject;
}

function fixture(input: Array<{ key: string; body: string | Buffer; attributes?: Partial<StorageMigrationObject> }>) {
  const objects = new Map<string, StoredObject>();
  const entries: StorageCopyManifestEntry[] = input.map(({ key, body: value, attributes }) => {
    const body = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
    const snapshot: StorageMigrationObject = {
      size: body.length,
      etag: `"${hash(body)}"`,
      contentType: key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      metadata: { fixture: 'source' },
      ...attributes,
    };
    objects.set(key, { body, snapshot: clone(snapshot) });
    return { key, source: clone(snapshot) };
  });
  const get = (key: string): StoredObject => {
    const value = objects.get(key);
    if (!value) throw new Error('Missing fixture object');
    return value;
  };
  const put = (key: string, body: Buffer, attributes: StorageMigrationObject) => {
    if (!key.startsWith(`tenants/${tenantId}/`) || objects.has(key)) throw new Error('Fixture forbids overwrites/source writes');
    objects.set(key, { body: Buffer.from(body), snapshot: { ...clone(attributes), size: body.length, etag: `"${hash(body)}"` } });
  };
  const plainTarget = (sourceKey: string, body = get(sourceKey).body) => {
    const source = get(sourceKey).snapshot;
    put(targetKey(sourceKey), body, {
      ...clone(source),
      metadata: { ...source.metadata, [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source) },
    });
  };
  const io = {
    head: jest.fn((key: string): Promise<StorageMigrationObject | undefined> => {
      const value = objects.get(key);
      return Promise.resolve(value ? clone(value.snapshot) : undefined);
    }),
    read: jest.fn((key: string, _source: StorageMigrationObject, limit: number): Promise<Buffer> => {
      const body = get(key).body;
      if (body.length > limit) throw new Error('Fixture read exceeds limit');
      return Promise.resolve(Buffer.from(body));
    }),
    digest: jest.fn((key: string, _source: StorageMigrationObject): Promise<string> => Promise.resolve(hash(get(key).body))),
    createDocument: jest.fn((key: string, body: Buffer, attributes: StorageMigrationObject): Promise<void> => {
      put(key, body, attributes);
      return Promise.resolve();
    }),
    copy: jest.fn((sourceKey: string, destinationKey: string, source: StorageMigrationObject): Promise<void> => {
      put(destinationKey, get(sourceKey).body, {
        ...clone(source),
        metadata: { ...source.metadata, [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source) },
      });
      return Promise.resolve();
    }),
    sourceKeys: jest.fn((): Promise<string[]> => Promise.resolve(entries.map((entry) => entry.key))),
    assertWriter: jest.fn(async (): Promise<void> => {}),
  } satisfies StorageCopyRewriteIO;
  const run = (documents: string[] = [], apply = true, concurrency = 1) =>
    copyWithDocumentRewrite(io, tenantId, entries, documents, bases, apply, concurrency);
  const noWrites = () => {
    expect(io.copy).not.toHaveBeenCalled();
    expect(io.createDocument).not.toHaveBeenCalled();
  };
  return { objects, entries, get, io, run, plainTarget, noWrites };
}

describe('complete-manifest create-only storage migration', () => {
  it('rewrites references to later-page keys before the first JSON write and preserves every source', async () => {
    const document = '{\n "asset": "https://storage.example.test/bucket/files/1024.bin", "id": 9007199254740993\n}';
    const f = fixture([
      { key: 'docs/page.json', body: document },
      ...Array.from({ length: 1025 }, (_, index) => ({ key: `files/${index}.bin`, body: Buffer.from([index % 256]) })),
    ]);
    const original = new Map(
      [...f.objects].map(([key, value]) => [key, { body: Buffer.from(value.body), snapshot: clone(value.snapshot) }]),
    );
    const results = await f.run(['docs/page.json'], true, 4);
    const expected = document.replace(
      'https://storage.example.test/bucket/files/1024.bin',
      '/api/files/raw?key=files%2F1024.bin',
    );
    expect(f.io.createDocument).toHaveBeenCalledTimes(1);
    expect(f.io.createDocument.mock.calls[0][1].toString()).toBe(expected);
    expect(f.get(targetKey('docs/page.json')).body.toString()).toBe(expected);
    expect(results[0].sha256).toBe(hash(Buffer.from(expected)));
    expect(results[0].operation).toBe(StorageCopyRewriteOperation.COPIED_REWRITTEN_DOCUMENT);
    expect(f.io.copy.mock.calls.some(([source]) => source === 'docs/page.json')).toBe(false);
    for (const [key, value] of original) {
      expect(f.get(key).body).toEqual(value.body);
      expect(f.get(key).snapshot).toEqual(value.snapshot);
    }
  });

  it('validates every selected JSON document before any binary or document write', async () => {
    const f = fixture([
      { key: 'files/a.bin', body: 'binary' },
      { key: 'docs/good.json', body: '{"ok":true}' },
      { key: 'docs/bad.json', body: '{broken' },
    ]);
    await expect(f.run(['docs/good.json', 'docs/bad.json'], true, 4)).rejects.toThrow();
    f.noWrites();
    expect(f.io.assertWriter).not.toHaveBeenCalled();
  });

  it('uses SHA-256 verification with an empty JSON subset before a caller may rewrite SQL URLs', async () => {
    const f = fixture([{ key: 'files/a.bin', body: Buffer.from([0, 255, 23, 0]) }]);
    const results = await f.run([]);
    expect(results[0].sha256).toBe(hash(f.get('files/a.bin').body));
    expect(results[0].operation).toBe(StorageCopyRewriteOperation.COPIED);
    expect(f.io.digest.mock.calls.map(([key]) => key)).toContain(targetKey('files/a.bin'));
    expect(f.io.sourceKeys).toHaveBeenCalledTimes(1);
  });

  it('rejects a same-size existing binary with the wrong SHA without any overwrite or SQL continuation', async () => {
    const f = fixture([
      { key: 'files/a.bin', body: 'original' },
      { key: 'files/b.bin', body: 'not-copied' },
    ]);
    f.plainTarget('files/a.bin', Buffer.from('tampered'));
    const sql = jest.fn();
    await expect(f.run([]).then(sql)).rejects.toThrow('expected bytes');
    f.noWrites();
    expect(sql).not.toHaveBeenCalled();
    expect(f.get(targetKey('files/a.bin')).body.toString()).toBe('tampered');
  });

  it('resumes only verified exact targets and never writes them again', async () => {
    const f = fixture([
      { key: 'docs/a.json', body: '{"url":"https://storage.example.test/bucket/files/a.bin"}' },
      { key: 'files/a.bin', body: 'binary' },
    ]);
    await f.run(['docs/a.json']);
    f.io.copy.mockClear();
    f.io.createDocument.mockClear();
    const result = await f.run(['docs/a.json']);
    expect(result.every((entry) => entry.operation === StorageCopyRewriteOperation.VERIFIED_EXISTING)).toBe(true);
    f.noWrites();
  });

  it('accepts an original plain copy only when selected JSON requires no byte change', async () => {
    const f = fixture([{ key: 'docs/a.json', body: '{"text":"unchanged"}' }]);
    f.plainTarget('docs/a.json');
    expect((await f.run(['docs/a.json']))[0].operation).toBe(StorageCopyRewriteOperation.VERIFIED_EXISTING);
    f.noWrites();
  });

  it('does not overwrite an existing plain JSON copy when rewriting changes its bytes', async () => {
    const f = fixture([
      { key: 'docs/a.json', body: '{"url":"https://storage.example.test/bucket/files/a.bin"}' },
      { key: 'files/a.bin', body: 'binary' },
    ]);
    f.plainTarget('docs/a.json');
    await expect(f.run(['docs/a.json'])).rejects.toThrow('explicit document rewrite plan');
    f.noWrites();
  });

  it.each([
    { contentType: 'text/html' },
    { contentEncoding: 'gzip' },
    { contentDisposition: 'inline' },
    { contentLanguage: 'fr' },
    { metadata: { changed: 'metadata-only' } },
  ])('rejects attributes-only drift in an existing target: %j', async (change) => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    f.plainTarget('files/a.bin');
    const destination = f.get(targetKey('files/a.bin'));
    Object.assign(
      destination.snapshot,
      change.metadata ? { metadata: { ...destination.snapshot.metadata, ...change.metadata } } : change,
    );
    await expect(f.run([])).rejects.toThrow('attributes differ');
    f.noWrites();
  });

  it('rejects rewritten target metadata belonging to another tenant', async () => {
    const f = fixture([{ key: 'docs/a.json', body: '{"text":"ok"}' }]);
    await f.run(['docs/a.json']);
    f.io.copy.mockClear();
    f.io.createDocument.mockClear();
    f.get(targetKey('docs/a.json')).snapshot.metadata['nervion-migration-tenant'] = '22222222-2222-4222-8222-222222222222';
    await expect(f.run(['docs/a.json'])).rejects.toThrow('attributes differ');
    f.noWrites();
  });

  it('does not accept a rewritten JSON target through the empty-subset binary-only path', async () => {
    const f = fixture([{ key: 'docs/a.json', body: '{"text":"ok"}' }]);
    await f.run(['docs/a.json']);
    expect(f.get(targetKey('docs/a.json')).snapshot.metadata[STORAGE_REWRITE_MARKER]).toBeDefined();
    f.io.copy.mockClear();
    f.io.createDocument.mockClear();
    await expect(f.run([])).rejects.toThrow('explicit document rewrite plan');
    f.noWrites();
  });

  it('checks writer ownership before starting any write', async () => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    f.io.assertWriter.mockRejectedValueOnce(new Error('Writer lock lost'));
    await expect(f.run()).rejects.toThrow('Writer lock lost');
    f.noWrites();
  });

  it('rejects a source snapshot changed between planning and the first write', async () => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    f.io.assertWriter.mockImplementationOnce(() => {
      f.get('files/a.bin').snapshot.versionId = 'new-version';
      return Promise.resolve();
    });
    await expect(f.run()).rejects.toThrow('Source changed');
    f.noWrites();
  });

  it('refuses a target that appears after planning instead of overwriting it', async () => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    f.io.assertWriter.mockImplementationOnce(() => {
      f.plainTarget('files/a.bin');
      return Promise.resolve();
    });
    await expect(f.run()).rejects.toThrow('Destination appeared');
    f.noWrites();
  });

  it.each(['source', 'target'])('rejects final %s snapshot drift before SQL continuation', async (where) => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    f.io.sourceKeys.mockImplementationOnce(() => {
      f.get(where === 'source' ? 'files/a.bin' : targetKey('files/a.bin')).snapshot.versionId = 'changed-after-copy';
      return Promise.resolve(['files/a.bin']);
    });
    const sql = jest.fn();
    await expect(f.run().then(sql)).rejects.toThrow(where === 'source' ? 'Source changed' : 'Destination changed');
    expect(sql).not.toHaveBeenCalled();
  });

  it.each([['files/a.bin', 'files/a.bin'], ['files/a.bin'], ['files/a.bin', 'files/new.bin']])(
    'rejects a duplicate, missing or changed final key manifest: %j',
    async (...keys) => {
      const f = fixture([
        { key: 'files/a.bin', body: 'a' },
        { key: 'files/b.bin', body: 'b' },
      ]);
      f.io.sourceKeys.mockResolvedValueOnce(keys);
      const sql = jest.fn();
      await expect(f.run().then(sql)).rejects.toThrow('Source key manifest changed');
      expect(sql).not.toHaveBeenCalled();
    },
  );

  it('dry-run checks source/target bytes but never acquires a writer or changes storage', async () => {
    const f = fixture([{ key: 'files/a.bin', body: 'binary' }]);
    const result = await f.run([], false);
    expect(result[0].sha256).toBe(hash(Buffer.from('binary')));
    expect(result[0].operation).toBe(StorageCopyRewriteOperation.PLAN_COPY);
    f.noWrites();
    expect(f.io.assertWriter).not.toHaveBeenCalled();
    expect(f.objects.size).toBe(1);
  });

  it.each([1, 4, 8])('bounds copy concurrency to %i operations', async (concurrency) => {
    const f = fixture(Array.from({ length: 17 }, (_, index) => ({ key: `files/${index}.bin`, body: String(index) })));
    const original = f.io.copy.getMockImplementation()!;
    let active = 0;
    let maximum = 0;
    f.io.copy.mockImplementation(async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await original(...args);
      active--;
    });
    await f.run([], true, concurrency);
    expect(maximum).toBe(concurrency);
    expect(active).toBe(0);
    expect(f.io.copy).toHaveBeenCalledTimes(17);
  });
});
