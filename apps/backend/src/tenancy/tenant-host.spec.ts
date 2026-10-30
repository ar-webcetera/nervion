import { createHmac } from 'node:crypto';
import { normalizeTenantHost, resolveTenantHost } from './tenant-host';

describe('Tenant host trust boundary', () => {
  const secret = 'test-proxy-secret-with-at-least-32-characters';
  const previous = process.env.TENANCY_PROXY_SECRET;
  beforeEach(() => {
    process.env.TENANCY_PROXY_SECRET = secret;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TENANCY_PROXY_SECRET;
    else process.env.TENANCY_PROXY_SECRET = previous;
  });

  const signed = (host: string, timestamp = `${Date.now()}`) => ({
    host: 'backend.internal:3026',
    'x-nervion-host': host,
    'x-nervion-timestamp': timestamp,
    'x-nervion-signature': createHmac('sha256', secret).update(`${timestamp}\n${host}`).digest('hex'),
  });

  it('normalizes hostname and port while ignoring untrusted forwarding headers', () => {
    expect(resolveTenantHost({ host: 'CLIENT.Nervion.ru:443', 'x-forwarded-host': 'other.nervion.ru' })).toBe(
      'client.nervion.ru',
    );
    expect(normalizeTenantHost('localhost:3000')).toBe('localhost');
  });

  it.each([
    'a.nervion.ru.evil/',
    'a.nervion.ru,b.nervion.ru',
    'a..nervion.ru',
    'a.nervion.ru.',
    '-a.nervion.ru',
    'a.nervion.ru:99999',
    'a.nervion.ru:0',
  ])('rejects malformed host %s', (host) => {
    expect(() => normalizeTenantHost(host)).toThrow();
  });

  it('accepts authenticated SSR host and rejects tampering, stale and partial signatures', () => {
    expect(resolveTenantHost(signed('client.nervion.ru'))).toBe('client.nervion.ru');
    expect(() => resolveTenantHost({ ...signed('client.nervion.ru'), 'x-nervion-host': 'other.nervion.ru' })).toThrow();
    expect(() => resolveTenantHost(signed('client.nervion.ru', `${Date.now() - 61_000}`))).toThrow();
    expect(() => resolveTenantHost({ host: 'client.nervion.ru', 'x-nervion-host': 'client.nervion.ru' })).toThrow();
    expect(() => resolveTenantHost({ ...signed('client.nervion.ru'), 'x-nervion-signature': ['x', 'y'] })).toThrow();
  });
});
