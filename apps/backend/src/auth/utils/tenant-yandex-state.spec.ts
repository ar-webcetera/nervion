import { createTenantYandexState, tenantYandexChallenge, verifyTenantYandexState } from './tenant-yandex-state';

describe('tenant Yandex OAuth state', () => {
  const tenant = { id: '7a9da7b8-0824-459a-93a8-a60ad7c17330', hostname: 'one.example.test' };
  const secret = 'test-only-secret-with-at-least-32-characters';

  afterEach(() => jest.restoreAllMocks());

  it('binds a random nonce to the tenant, hostname and PKCE verifier', () => {
    const flow = createTenantYandexState(tenant, secret);
    expect(flow.challenge).toBe(tenantYandexChallenge(flow.verifier));
    expect(verifyTenantYandexState(tenant, secret, flow.state, flow.state, flow.verifier)).toBe(true);
    expect(createTenantYandexState(tenant, secret).state).not.toBe(flow.state);
    expect(verifyTenantYandexState({ ...tenant, id: 'another-tenant' }, secret, flow.state, flow.state, flow.verifier)).toBe(
      false,
    );
    expect(
      verifyTenantYandexState({ ...tenant, hostname: 'two.example.test' }, secret, flow.state, flow.state, flow.verifier),
    ).toBe(false);
    expect(verifyTenantYandexState(tenant, 'different-secret', flow.state, flow.state, flow.verifier)).toBe(false);
    expect(verifyTenantYandexState(tenant, secret, flow.state, flow.state, 'a'.repeat(43))).toBe(false);
  });

  it('rejects missing, substituted, malformed and non-ASCII cookies without throwing', () => {
    const flow = createTenantYandexState(tenant, secret);
    for (const cookie of ['', createTenantYandexState(tenant, secret).state, 'я'.repeat(flow.state.length), flow.state + '.']) {
      expect(verifyTenantYandexState(tenant, secret, flow.state, cookie, flow.verifier)).toBe(false);
    }
    for (const state of ['', flow.state + '.', flow.state.replace(/^v1/, 'v2')]) {
      expect(verifyTenantYandexState(tenant, secret, state, state, flow.verifier)).toBe(false);
    }
  });

  it('expires after ten minutes and rejects future timestamps', () => {
    const now = 1800000000000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const flow = createTenantYandexState(tenant, secret);
    clock.mockReturnValue(now + 10 * 60 * 1000);
    expect(verifyTenantYandexState(tenant, secret, flow.state, flow.state, flow.verifier)).toBe(false);
    clock.mockReturnValue(now - 1);
    expect(verifyTenantYandexState(tenant, secret, flow.state, flow.state, flow.verifier)).toBe(false);
  });
});
