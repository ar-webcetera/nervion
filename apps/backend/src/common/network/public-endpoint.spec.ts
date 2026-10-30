import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isPublicAddress, parseAllowedHosts, resolvePublicEndpoint, validatePublicEndpoint } from './public-endpoint';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const lookupAll = jest.mocked(lookup as (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>);

describe('public integration endpoints', () => {
  const policy = { allowedHosts: ['example.com'] };
  afterEach(() => jest.resetAllMocks());

  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.10.0.1',
    '172.16.1.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '168.63.129.16',
    '198.18.0.1',
    '192.0.2.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2002:7f00:1::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'accepts ordinary public unicast %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'https://example.com:8443/',
    'https://user:secret@example.com/',
    'https://example.com/#fragment',
    'https://example.com.attacker.test/',
    'https://sub.example.com/',
    'http://2130706433/',
    'http://[::1]/',
    'https://example.com./',
  ])('rejects URL %s', (url) => {
    expect(() => validatePublicEndpoint(url, policy)).toThrow();
  });

  it('requires an explicit exact operator allowlist', () => {
    expect(parseAllowedHosts(' Example.COM, git.example.com ')).toEqual(['example.com', 'git.example.com']);
    expect(() => validatePublicEndpoint('https://example.com/', { allowedHosts: [] })).toThrow();
    expect(validatePublicEndpoint('https://example.com:443/health?q=1', policy).port).toBe('');
  });

  it('rejects mixed public/private DNS answers', async () => {
    lookupAll.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolvePublicEndpoint('https://example.com/', policy)).rejects.toThrow();
  });

  it('pins one validated answer and performs exactly one lookup', async () => {
    lookupAll.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const target = await resolvePublicEndpoint('https://example.com/health', policy);
    expect(target.address).toBe('93.184.216.34');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });
});
