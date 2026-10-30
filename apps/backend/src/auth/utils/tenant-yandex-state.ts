import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantDescriptor } from '@tracker/contracts';

type OAuthTenant = Pick<TenantDescriptor, 'id' | 'hostname'>;
const STATE_TTL_MS = 10 * 60 * 1000;
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

export const tenantYandexChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

function signState(tenant: OAuthTenant, secret: string, timestamp: string, nonce: string, verifier: string): string {
  return createHmac('sha256', secret)
    .update(['nervion:yandex:state:v1', tenant.id, tenant.hostname, timestamp, nonce, tenantYandexChallenge(verifier)].join('\n'))
    .digest('base64url');
}

export function createTenantYandexState(
  tenant: OAuthTenant,
  secret: string,
): { state: string; verifier: string; challenge: string } {
  const timestamp = String(Date.now());
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  return {
    state: `v1.${timestamp}.${nonce}.${signState(tenant, secret, timestamp, nonce, verifier)}`,
    verifier,
    challenge: tenantYandexChallenge(verifier),
  };
}

export function verifyTenantYandexState(
  tenant: OAuthTenant,
  secret: string,
  state: string,
  cookieState: string,
  verifier: string,
): boolean {
  const match = STATE_PATTERN.exec(state);
  if (
    !secret ||
    !match ||
    !STATE_PATTERN.test(cookieState) ||
    !VERIFIER_PATTERN.test(verifier) ||
    state.length !== cookieState.length
  )
    return false;
  if (!timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) return false;
  const age = Date.now() - Number(match[1]);
  if (age < 0 || age >= STATE_TTL_MS) return false;
  const expected = signState(tenant, secret, match[1], match[2], verifier);
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected));
}
