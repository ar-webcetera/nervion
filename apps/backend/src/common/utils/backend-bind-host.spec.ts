import { backendBindHost } from './backend-bind-host';

describe('backendBindHost', () => {
  it('preserves the existing default', () => expect(backendBindHost(undefined)).toBeUndefined());
  it.each(['127.0.0.1', '::1', '0.0.0.0', '192.0.2.1'])('accepts literal IP %s', (value) => {
    expect(backendBindHost(value)).toBe(value);
  });
  it.each(['', 'localhost', 'https://127.0.0.1', '127.0.0.1:3000', ' 127.0.0.1', '999.1.1.1', '::1%eth0'])(
    'rejects %s',
    (value) => {
      expect(() => backendBindHost(value)).toThrow('BACKEND_BIND_HOST');
    },
  );
});
