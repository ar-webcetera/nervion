import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface PublicEndpointOptions {
  allowedHosts: readonly string[];
  protocols?: readonly string[];
}

export interface PublicEndpoint {
  url: URL;
  address: string;
  family: 4 | 6;
}

const denied = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['168.63.129.16', 32],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(network, prefix, 'ipv4');
// Only ordinary IPv6 global unicast is allowed. Exclude transition, special-use,
// benchmark, documentation and mapped-address ranges instead of following them.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  denied.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
  return false;
}

/** Operator-controlled, exact DNS names only. Wildcards and URL syntax fail closed. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function validatePublicEndpoint(rawUrl: string, options: PublicEndpointOptions): URL {
  let url: URL;
  try {
    if (rawUrl.length > 2048 || /[\s\\]/.test(rawUrl)) throw new Error();
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Некорректный URL');
  }
  if (
    !(options.protocols ?? ['https:', 'http:']).includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.port
  ) {
    throw new BadRequestException('Разрешен только HTTP/HTTPS на стандартном порту, без учетных данных в URL');
  }
  const host = url.hostname.toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
    !host.includes('.') ||
    host.includes('..') ||
    isIP(host) ||
    !options.allowedHosts.includes(host)
  ) {
    throw new BadRequestException('Домен не разрешен оператором платформы');
  }
  return url;
}

/** Resolve once; callers MUST connect to this address, never resolve the name again. */
export async function resolvePublicEndpoint(rawUrl: string, options: PublicEndpointOptions): Promise<PublicEndpoint> {
  const url = validatePublicEndpoint(rawUrl, options);
  let timer: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), 3_000);
        timer.unref();
      }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new BadRequestException('Адрес недоступен для внешней проверки');
    }
    const selected = addresses.find((address) => address.family === 4) ?? addresses[0];
    if (selected.family !== 4 && selected.family !== 6) throw new Error('Unsupported address family');
    return { url, address: selected.address, family: selected.family };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Не удалось безопасно определить адрес сервера');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
