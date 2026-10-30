import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashIdentityPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyIdentityPassword(password: string, stored: string | null, legacySalt?: string): boolean {
  if (!stored) return false;
  if (!stored.startsWith('scrypt$')) {
    if (!legacySalt || !/^[a-f0-9]{40}$/i.test(stored)) return false;
    const actual = createHmac('sha1', legacySalt).update(password).digest();
    return timingSafeEqual(actual, Buffer.from(stored, 'hex'));
  }
  const parts = stored.split('$');
  const saltHex = parts.length === 6 ? parts[4] : parts.length === 3 ? parts[1] : '';
  const hashHex = parts.length === 6 ? parts[5] : parts.length === 3 ? parts[2] : '';
  if (!/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(hashHex)) return false;
  // Accept the project's existing format, without trusting cost parameters from storage.
  if (parts.length === 6 && (Number(parts[1]) !== SCRYPT.N || Number(parts[2]) !== SCRYPT.r || Number(parts[3]) !== SCRYPT.p))
    return false;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64, SCRYPT);
  return timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
}
