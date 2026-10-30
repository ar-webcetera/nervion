import { isIP } from 'node:net';

/** Omitted keeps the previous Node listen behaviour. Hostnames are not accepted. */
export function backendBindHost(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value || !/^[a-fA-F0-9:.]+$/.test(value) || !isIP(value)) {
    throw new Error('BACKEND_BIND_HOST must be an IPv4 or IPv6 address');
  }
  return value;
}
