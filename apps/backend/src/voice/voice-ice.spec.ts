import { createHmac } from 'node:crypto';
import { configuredIceServers, voiceIceServers, voicePortRange } from './voice-ice';

describe('voice ICE configuration', () => {
  const keys = [
    'MEDIASOUP_ICE_SERVERS',
    'MEDIASOUP_TURN_URLS',
    'MEDIASOUP_TURN_SECRET',
    'MEDIASOUP_TURN_TTL_SECONDS',
    'MEDIASOUP_MIN_PORT',
    'MEDIASOUP_MAX_PORT',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('issues short-lived tenant/user-bound TURN credentials without revealing the secret', () => {
    process.env.MEDIASOUP_ICE_SERVERS = '';
    process.env.MEDIASOUP_TURN_URLS = 'turns:turn.example.test:5349';
    process.env.MEDIASOUP_TURN_SECRET = 'local-test-shared-turn-secret-at-least-32';
    process.env.MEDIASOUP_TURN_TTL_SECONDS = '3600';
    const [server] = voiceIceServers('tenant-a', 42);
    expect(server.username).toMatch(/^\d+:tenant-a:42$/);
    expect(server.credential).toBe(
      createHmac('sha1', process.env.MEDIASOUP_TURN_SECRET).update(server.username!).digest('base64'),
    );
    expect(JSON.stringify(server)).not.toContain(process.env.MEDIASOUP_TURN_SECRET);
    expect(voiceIceServers('tenant-b', 42)[0].credential).not.toBe(server.credential);
  });

  it('rejects a malformed port range', () => {
    process.env.MEDIASOUP_MIN_PORT = '49999';
    process.env.MEDIASOUP_MAX_PORT = '40000';
    expect(() => voicePortRange()).toThrow('диапазон');
  });

  it('preserves legacy JSON ICE configuration including authenticated TURN', () => {
    const raw =
      '[{"urls":["stun:stun.example.test:3478"]},{"urls":"turns:turn.example.test:5349","username":"legacy","credential":"test"}]';
    expect(configuredIceServers(raw, false)).toEqual(JSON.parse(raw));
    expect(() => configuredIceServers(raw, true)).toThrow('SaaS TURN');
  });

  it('supports comma-separated STUN configuration', () => {
    expect(configuredIceServers('stun:one.example.test:3478, stun:two.example.test:3478', true)).toHaveLength(2);
  });
});
