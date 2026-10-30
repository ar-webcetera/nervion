import { createHash } from 'node:crypto';
import {
  STORAGE_REWRITE_MARKER,
  STORAGE_SOURCE_MARKER,
  storageSourceFingerprint,
  verifyMigratedStorageObject,
  type StorageMigrationObject,
} from './tenant-storage-document-rewrite';
import { rewriteJsonDocumentText } from './tenant-storage-url-rewrite';
import { runStorageMigrationPage } from './tenant-storage-migration-concurrency';
import { StorageCopyRewriteOperation } from './tenant-storage-copy-rewrite.enums';

export const MAX_STORAGE_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const MAX_STORAGE_REWRITE_PLAN_BYTES = 64 * 1024 * 1024;
export const MAX_STORAGE_MANIFEST_OBJECTS = 50_000;

export interface StorageCopyManifestEntry {
  key: string;
  source: StorageMigrationObject;
}

export interface StorageCopyRewriteIO {
  head(key: string): Promise<StorageMigrationObject | undefined>;
  read(key: string, source: StorageMigrationObject, limit: number): Promise<Buffer>;
  digest(key: string, source: StorageMigrationObject): Promise<string>;
  createDocument(key: string, body: Buffer, attributes: StorageMigrationObject): Promise<void>;
  copy(sourceKey: string, targetKey: string, source: StorageMigrationObject): Promise<void>;
  sourceKeys(): Promise<string[]>;
  assertWriter(): Promise<void>;
}

export interface StorageCopyRewriteResult {
  sourceKey: string;
  targetKey: string;
  sha256: string;
  size: number;
  operation: StorageCopyRewriteOperation;
}

interface CopyPlan {
  entry: StorageCopyManifestEntry;
  result: StorageCopyRewriteResult;
  body?: Buffer;
  attributes?: StorageMigrationObject;
  target?: StorageMigrationObject;
  sourceSha256?: string;
}

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const metadata = (value: Record<string, string>): string =>
  JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

export function sameStorageSnapshot(left: StorageMigrationObject, right: StorageMigrationObject): boolean {
  return (
    left.etag === right.etag &&
    left.size === right.size &&
    left.versionId === right.versionId &&
    left.contentType === right.contentType &&
    left.contentDisposition === right.contentDisposition &&
    left.contentEncoding === right.contentEncoding &&
    left.contentLanguage === right.contentLanguage &&
    metadata(left.metadata) === metadata(right.metadata)
  );
}

function targetKey(tenantId: string, key: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId) ||
    !key ||
    Buffer.byteLength(key) > 1024 ||
    key.startsWith('/') ||
    key.startsWith('tenants/') ||
    key.includes('\\') ||
    key.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid copy manifest key or tenant');
  const target = `tenants/${tenantId}/${key}`;
  if (Buffer.byteLength(target) > 1024) throw new Error('Tenant destination key exceeds the storage limit');
  return target;
}

async function assertSource(io: StorageCopyRewriteIO, entry: StorageCopyManifestEntry): Promise<void> {
  const current = await io.head(entry.key);
  if (!current || !sameStorageSnapshot(entry.source, current)) throw new Error('Source changed after manifest planning');
}

async function verifyTarget(
  io: StorageCopyRewriteIO,
  tenantId: string,
  plan: CopyPlan,
  target: StorageMigrationObject,
): Promise<void> {
  const rewritten = target.metadata[STORAGE_REWRITE_MARKER] !== undefined;
  if ((rewritten && !plan.attributes) || (!rewritten && plan.body && plan.sourceSha256 !== plan.result.sha256)) {
    throw new Error('Destination does not match the explicit document rewrite plan; no overwrite');
  }
  const expected = plan.attributes ?? plan.entry.source;
  const expectedMetadata = rewritten
    ? expected.metadata
    : {
        ...plan.entry.source.metadata,
        [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(plan.entry.key, plan.entry.source),
      };
  if (
    target.contentType !== expected.contentType ||
    target.contentDisposition !== expected.contentDisposition ||
    target.contentEncoding !== expected.contentEncoding ||
    target.contentLanguage !== expected.contentLanguage ||
    metadata(target.metadata) !== metadata(expectedMetadata)
  ) {
    throw new Error('Destination attributes differ from the expected copy; no overwrite');
  }
  await verifyMigratedStorageObject(
    { read: async (key) => io.read(key, target, MAX_STORAGE_DOCUMENT_BYTES) },
    tenantId,
    plan.entry.key,
    plan.entry.source,
    target,
  );
  if (target.size !== plan.result.size || (await io.digest(plan.result.targetKey, target)) !== plan.result.sha256) {
    throw new Error('Existing destination differs from expected bytes; no overwrite');
  }
  if (target.metadata[STORAGE_REWRITE_MARKER] && target.metadata[STORAGE_REWRITE_MARKER] !== plan.result.sha256) {
    throw new Error('Existing destination has a different rewrite plan; no overwrite');
  }
}

/** Create-only migration under an externally enforced freeze and one operator.
 * HEAD+PUT is deliberately not described as CAS on providers ignoring conditions.
 */
export async function copyWithDocumentRewrite(
  io: StorageCopyRewriteIO,
  tenantId: string,
  entries: readonly StorageCopyManifestEntry[],
  documentKeys: readonly string[],
  bases: URL[],
  apply: boolean,
  concurrency: number,
): Promise<StorageCopyRewriteResult[]> {
  if (!entries.length || entries.length > MAX_STORAGE_MANIFEST_OBJECTS) throw new Error('Copy manifest is empty or too large');
  const keys = new Set(entries.map((entry) => entry.key));
  if (
    keys.size !== entries.length ||
    new Set(documentKeys).size !== documentKeys.length ||
    documentKeys.some((key) => !keys.has(key))
  ) {
    throw new Error('Rewrite documents must be a unique explicit subset of the complete manifest');
  }
  const selected = new Set(documentKeys);
  if (entries.some(({ source }) => !Number.isSafeInteger(source.size) || source.size < 0 || !source.etag)) {
    throw new Error('Invalid source snapshot');
  }
  const plans: CopyPlan[] = entries.map((entry) => ({
    entry,
    result: {
      sourceKey: entry.key,
      targetKey: targetKey(tenantId, entry.key),
      sha256: '',
      size: entry.source.size,
      operation: selected.has(entry.key)
        ? StorageCopyRewriteOperation.PLAN_REWRITTEN_DOCUMENT
        : StorageCopyRewriteOperation.PLAN_COPY,
    },
  }));
  let documentBytes = 0;
  // Validate every selected document before any destination is written. Holding
  // only rewritten bytes is bounded independently from binary object sizes.
  for (const plan of plans) {
    if (!selected.has(plan.entry.key)) continue;
    const { source, key } = plan.entry;
    if (source.size > MAX_STORAGE_DOCUMENT_BYTES || source.contentEncoding)
      throw new Error('Rewrite requires uncompressed UTF-8 JSON up to 16 MiB');
    const original = await io.read(key, source, MAX_STORAGE_DOCUMENT_BYTES);
    if (original.length !== source.size) throw new Error('Source document size changed');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
    const body = Buffer.from(rewriteJsonDocumentText(text, bases, keys), 'utf8');
    documentBytes += body.length;
    if (body.length > MAX_STORAGE_DOCUMENT_BYTES || documentBytes > MAX_STORAGE_REWRITE_PLAN_BYTES)
      throw new Error('Document rewrite plan exceeds its memory budget');
    plan.body = body;
    plan.sourceSha256 = sha256(original);
    plan.result.sha256 = sha256(body);
    plan.result.size = body.length;
    plan.attributes = {
      ...source,
      size: body.length,
      metadata: {
        ...source.metadata,
        [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(key, source),
        'nervion-migration-source-size': String(source.size),
        'nervion-migration-tenant': tenantId,
        'nervion-rewrite-version': 'json-links-v1',
        [STORAGE_REWRITE_MARKER]: plan.result.sha256,
      },
    };
    await assertSource(io, plan.entry);
  }
  // All existing destinations are checked before the first write. Resuming
  // never repairs or overwrites an old, partial or unrelated target.
  await runStorageMigrationPage(plans, concurrency, async (plan) => {
    if (!plan.body) plan.result.sha256 = await io.digest(plan.entry.key, plan.entry.source);
    await assertSource(io, plan.entry);
    plan.target = await io.head(plan.result.targetKey);
    if (plan.target) {
      await verifyTarget(io, tenantId, plan, plan.target);
      plan.result.operation = StorageCopyRewriteOperation.VERIFIED_EXISTING;
    }
  });
  if (apply) {
    await io.assertWriter();
    await runStorageMigrationPage(plans, concurrency, async (plan) => {
      if (plan.target) return;
      await io.assertWriter();
      await assertSource(io, plan.entry);
      // The operator's exclusive-writer freeze is still required across this
      // check and the write. No storage condition is assumed to be honored.
      if (await io.head(plan.result.targetKey)) throw new Error('Destination appeared after planning; no overwrite');
      if (plan.body && plan.attributes) {
        await io.createDocument(plan.result.targetKey, plan.body, plan.attributes);
        plan.result.operation = StorageCopyRewriteOperation.COPIED_REWRITTEN_DOCUMENT;
      } else {
        await io.copy(plan.entry.key, plan.result.targetKey, plan.entry.source);
        plan.result.operation = StorageCopyRewriteOperation.COPIED;
      }
      plan.target = await io.head(plan.result.targetKey);
      if (!plan.target) throw new Error('Created destination is missing');
      await verifyTarget(io, tenantId, plan, plan.target);
    });
    await io.assertWriter();
    const finalKeys = await io.sourceKeys();
    if (finalKeys.length !== keys.size || new Set(finalKeys).size !== keys.size || finalKeys.some((key) => !keys.has(key)))
      throw new Error('Source key manifest changed; database URLs must not be rewritten');
    await runStorageMigrationPage(plans, concurrency, async (plan) => {
      await assertSource(io, plan.entry);
      const target = await io.head(plan.result.targetKey);
      if (!target || !plan.target || !sameStorageSnapshot(plan.target, target))
        throw new Error('Destination changed during final verification');
    });
    await io.assertWriter();
  }
  return plans.map((plan) => plan.result);
}
