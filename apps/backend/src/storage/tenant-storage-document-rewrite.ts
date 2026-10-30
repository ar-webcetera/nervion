import { createHash } from 'node:crypto';
import { rewriteJsonDocumentText } from './tenant-storage-url-rewrite';

export const STORAGE_SOURCE_MARKER = 'nervion-migration-source';
export const STORAGE_REWRITE_MARKER = 'nervion-rewrite-sha256';
const SOURCE_SIZE_MARKER = 'nervion-migration-source-size';
const TENANT_MARKER = 'nervion-migration-tenant';
const VERSION_MARKER = 'nervion-rewrite-version';
const REWRITE_VERSION = 'json-links-v1';
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export interface StorageMigrationObject {
  size: number;
  etag: string;
  versionId?: string;
  metadata: Record<string, string>;
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

export interface StorageDocumentMigrationIO {
  head(key: string): Promise<StorageMigrationObject>;
  read(key: string, etag: string): Promise<Buffer>;
  assertConditionalWrites(tenantId: string): Promise<void>;
  write(key: string, body: Buffer, attributes: StorageMigrationObject, expectedEtag: string): Promise<void>;
}

export enum StorageDocumentRewriteOperation {
  UNCHANGED = 'unchanged-document',
  PLAN = 'plan-rewrite-document',
  REWRITE = 'rewrite-document',
  VERIFIED = 'verified-rewritten-document',
}

export interface StorageDocumentRewriteResult {
  sourceKey: string;
  targetKey: string;
  operation: StorageDocumentRewriteOperation;
  size: number;
  sha256: string;
}

interface DocumentPlan {
  result: StorageDocumentRewriteResult;
  source: StorageMigrationObject;
  target: StorageMigrationObject;
  body: Buffer;
  attributes: StorageMigrationObject;
}

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

export function storageSourceFingerprint(key: string, source: StorageMigrationObject): string {
  return createHash('sha256').update(`${key}\n${source.etag}\n${source.size}`).digest('hex');
}

function targetKeyFor(tenantId: string, key: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId)) {
    throw new Error('Invalid storage migration tenant UUID');
  }
  if (
    !key ||
    key.startsWith('/') ||
    key.startsWith('tenants/') ||
    key.includes('\\') ||
    key.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Invalid legacy storage key');
  }
  return `tenants/${tenantId}/${key}`;
}

export function parseStorageRewriteKeys(raw: string, copiedKeys: ReadonlySet<string>): string[] {
  const keys = JSON.parse(raw) as string[];
  if (!Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== 'string' || !copiedKeys.has(key))) {
    throw new Error('Document rewrite keys must be a non-empty JSON array of keys in the verified copy manifest');
  }
  return [...new Set(keys)];
}

/** A rewritten destination is trusted only after checking both source identity and current bytes. */
export async function verifyMigratedStorageObject(
  io: Pick<StorageDocumentMigrationIO, 'read'>,
  tenantId: string,
  sourceKey: string,
  source: StorageMigrationObject,
  target: StorageMigrationObject,
): Promise<void> {
  const targetKey = targetKeyFor(tenantId, sourceKey);
  if (target.metadata[STORAGE_SOURCE_MARKER] !== storageSourceFingerprint(sourceKey, source)) {
    throw new Error(`Destination has a different migration source; no overwrite: ${targetKey}`);
  }
  const rewrittenHash = target.metadata[STORAGE_REWRITE_MARKER];
  if (rewrittenHash === undefined) {
    if (
      target.size !== source.size ||
      target.metadata[VERSION_MARKER] ||
      target.metadata[SOURCE_SIZE_MARKER] ||
      target.metadata[TENANT_MARKER]
    ) {
      throw new Error(`Destination differs from the original copy; no overwrite: ${targetKey}`);
    }
    return;
  }
  if (
    !/^[a-f0-9]{64}$/.test(rewrittenHash) ||
    target.metadata[VERSION_MARKER] !== REWRITE_VERSION ||
    target.metadata[TENANT_MARKER] !== tenantId ||
    target.metadata[SOURCE_SIZE_MARKER] !== String(source.size) ||
    target.size > MAX_DOCUMENT_BYTES
  ) {
    throw new Error(`Invalid rewritten destination metadata: ${targetKey}`);
  }
  const body = await io.read(targetKey, target.etag);
  if (body.length !== target.size || sha256(body) !== rewrittenHash) {
    throw new Error(`Rewritten destination has changed; no overwrite: ${targetKey}`);
  }
}

async function planDocument(
  io: StorageDocumentMigrationIO,
  tenantId: string,
  sourceKey: string,
  bases: URL[],
  copiedKeys: ReadonlySet<string>,
): Promise<DocumentPlan> {
  if (!copiedKeys.has(sourceKey)) throw new Error('Document is outside the verified copy manifest');
  const targetKey = targetKeyFor(tenantId, sourceKey);
  const source = await io.head(sourceKey);
  const target = await io.head(targetKey);
  await verifyMigratedStorageObject(io, tenantId, sourceKey, source, target);
  if (source.size > MAX_DOCUMENT_BYTES || source.contentEncoding) {
    throw new Error(`Document must be uncompressed UTF-8 JSON up to 16 MiB: ${sourceKey}`);
  }
  const original = await io.read(sourceKey, source.etag);
  if (original.length !== source.size) throw new Error(`Source size changed: ${sourceKey}`);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
  const body = Buffer.from(rewriteJsonDocumentText(text, bases, copiedKeys), 'utf8');
  if (body.length > MAX_DOCUMENT_BYTES) throw new Error(`Rewritten document exceeds 16 MiB: ${sourceKey}`);
  const hash = sha256(body);
  let operation = StorageDocumentRewriteOperation.PLAN;
  if (target.metadata[STORAGE_REWRITE_MARKER]) {
    if (target.metadata[STORAGE_REWRITE_MARKER] !== hash) {
      throw new Error(`Existing document rewrite differs from this plan; no overwrite: ${targetKey}`);
    }
    operation = StorageDocumentRewriteOperation.VERIFIED;
  } else {
    const existing = await io.read(targetKey, target.etag);
    if (!existing.equals(original)) throw new Error(`Destination is no longer the original copy: ${targetKey}`);
    if (body.equals(original)) operation = StorageDocumentRewriteOperation.UNCHANGED;
  }
  return {
    result: { sourceKey, targetKey, operation, size: body.length, sha256: hash },
    source,
    target,
    body,
    attributes: {
      ...source,
      size: body.length,
      metadata: {
        ...source.metadata,
        [STORAGE_SOURCE_MARKER]: storageSourceFingerprint(sourceKey, source),
        [SOURCE_SIZE_MARKER]: String(source.size),
        [TENANT_MARKER]: tenantId,
        [VERSION_MARKER]: REWRITE_VERSION,
        [STORAGE_REWRITE_MARKER]: hash,
      },
    },
  };
}

/** Separate operator stage. Planning every selected document completes before the first write. */
export async function rewriteTenantJsonDocuments(
  io: StorageDocumentMigrationIO,
  tenantId: string,
  keys: string[],
  bases: URL[],
  copiedKeys: ReadonlySet<string>,
  apply: boolean,
): Promise<StorageDocumentRewriteResult[]> {
  const plans: DocumentPlan[] = [];
  for (const key of keys) plans.push(await planDocument(io, tenantId, key, bases, copiedKeys));
  if (apply && plans.some((plan) => plan.result.operation === StorageDocumentRewriteOperation.PLAN)) {
    await io.assertConditionalWrites(tenantId);
    for (const plan of plans) {
      if (plan.result.operation !== StorageDocumentRewriteOperation.PLAN) continue;
      const currentSource = await io.head(plan.result.sourceKey);
      if (
        storageSourceFingerprint(plan.result.sourceKey, currentSource) !==
        storageSourceFingerprint(plan.result.sourceKey, plan.source)
      ) {
        throw new Error(`Source changed after planning: ${plan.result.sourceKey}`);
      }
      await io.write(plan.result.targetKey, plan.body, plan.attributes, plan.target.etag);
      const updated = await io.head(plan.result.targetKey);
      await verifyMigratedStorageObject(io, tenantId, plan.result.sourceKey, plan.source, updated);
      if (updated.size !== plan.body.length || updated.metadata[STORAGE_REWRITE_MARKER] !== plan.result.sha256) {
        throw new Error(`Document rewrite verification failed: ${plan.result.targetKey}`);
      }
      plan.result.operation = StorageDocumentRewriteOperation.REWRITE;
    }
  }
  return plans.map((plan) => plan.result);
}
