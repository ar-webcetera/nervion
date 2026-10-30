import { createHmac } from 'crypto';
import { hashIdentityPassword, verifyIdentityPassword } from './password';

describe('global identity password compatibility', () => {
  it('accepts the current scrypt format and rejects a different password', () => {
    const encoded = hashIdentityPassword('an-example-long-password');
    expect(verifyIdentityPassword('an-example-long-password', encoded)).toBe(true);
    expect(verifyIdentityPassword('another-password', encoded)).toBe(false);
  });

  it('verifies legacy passwords only with the explicit migration salt', () => {
    const hash = createHmac('sha1', 'old-jwt-secret').update('old-password').digest('hex');
    expect(verifyIdentityPassword('old-password', hash)).toBe(false);
    expect(verifyIdentityPassword('old-password', hash, 'old-jwt-secret')).toBe(true);
    expect(verifyIdentityPassword('wrong', hash, 'old-jwt-secret')).toBe(false);
  });

  it('fails closed for malformed hashes and untrusted cost parameters', () => {
    expect(verifyIdentityPassword('password', null)).toBe(false);
    expect(verifyIdentityPassword('password', 'scrypt$bad')).toBe(false);
    const encoded = hashIdentityPassword('an-example-long-password');
    expect(verifyIdentityPassword('an-example-long-password', encoded.replace('$16384$', '$1073741824$'))).toBe(false);
  });
});
