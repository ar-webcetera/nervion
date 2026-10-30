import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
import type { TenantDescriptor } from '@tracker/contracts';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthService } from './jwt.service';
import { YandexOauthService } from './yandex-oauth.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlatformService } from '../platform/platform.service';
import { PlatformMembership } from '../platform/entities/platform.platform-entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';
import {
  TENANT_YANDEX_OAUTH_PKCE_COOKIE,
  TENANT_YANDEX_OAUTH_STATE_COOKIE,
  YANDEX_OAUTH_LINK_COOKIE,
  YANDEX_OAUTH_STATE_COOKIE,
} from './utils/yandex-oauth-cookies';

describe('SaaS Yandex login', () => {
  const hostname = 'one.example.test';
  let service: AuthService;
  let config: ConfigService;
  let tenant: TenantDescriptor;
  let user: Users;
  let membership: PlatformMembership;
  const users = { findOneBy: jest.fn(), findOne: jest.fn(), update: jest.fn(), save: jest.fn() };
  const oauth = { isConfigured: jest.fn(), buildAuthorizeUrl: jest.fn(), exchangeCode: jest.fn(), fetchUser: jest.fn() };
  const context = { isEnabled: jest.fn(), require: jest.fn() };
  const platform = { assertMembership: jest.fn(), sessionClaims: jest.fn() };
  const jwt = { generateToken: jest.fn() };
  const audit = { record: jest.fn() };

  const request = (cookies: Record<string, string> = {}, host = hostname) => ({
    headers: { host }, hostname: host, protocol: 'https', cookies,
    get: (name: string) => name === 'host' ? host : undefined,
  }) as Request & { cookies: Record<string, string> };

  const response = () => {
    const cookies: Record<string, string> = {};
    const options: Record<string, CookieOptions> = {};
    const cleared: string[] = [];
    const redirects: string[] = [];
    const res = {} as Response;
    res.cookie = (name: string, value: string, cookieOptions: CookieOptions = {}) => {
      cookies[name] = value;
      options[name] = cookieOptions;
      return res;
    };
    res.clearCookie = (name: string) => { cleared.push(name); return res; };
    res.redirect = (urlOrStatus: string | number, location?: string) => {
      redirects.push(typeof urlOrStatus === 'string' ? urlOrStatus : location || '');
    };
    return { res, cookies, options, cleared, redirects };
  };

  const begin = () => {
    const start = response();
    service.startYandexOAuth(start.res, request());
    return { ...start, state: start.cookies[TENANT_YANDEX_OAUTH_STATE_COOKIE] };
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    config = new ConfigService({
      NODE_ENV: 'production', JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
      YANDEX_OAUTH_TENANT_HOSTS: hostname, AUTH_PUBLIC_ORIGIN: 'https://do-not-use.example.test',
    });
    tenant = {
      id: '7a9da7b8-0824-459a-93a8-a60ad7c17330', slug: 'one', hostname,
      status: TenantStatus.ACTIVE, readOnly: false, featureFlags: {}, databaseShardId: 'data_1', storageNamespace: 'tenants/one/',
    };
    user = Object.assign(new Users(), {
      id: 42, email: 'existing@example.test', role: ROLES.admin, yandex_id: 'provider-id', deletedAt: null,
    });
    membership = Object.assign(new PlatformMembership(), {
      id: 'membership-id', identityId: 'identity-id', tenantId: tenant.id, localUserId: user.id,
      role: user.role, status: MembershipStatus.ACTIVE, identityVersion: 1,
    });
    context.isEnabled.mockReturnValue(true);
    context.require.mockImplementation(() => ({ tenant }));
    users.findOneBy.mockResolvedValue(user);
    users.findOne.mockResolvedValue(user);
    oauth.isConfigured.mockReturnValue(true);
    oauth.buildAuthorizeUrl.mockReturnValue('https://oauth.yandex.ru/authorize');
    oauth.exchangeCode.mockResolvedValue('provider-access-token');
    oauth.fetchUser.mockResolvedValue({ yandexId: user.yandex_id, email: 'untrusted-other-email@example.test' });
    platform.assertMembership.mockResolvedValue(membership);
    platform.sessionClaims.mockImplementation(() => ({
      tenantId: tenant.id, identityId: membership.identityId, membershipId: membership.id, identityVersion: 1,
    }));
    jwt.generateToken.mockReturnValue('tenant-session-token');
    audit.record.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: config },
        { provide: getRepositoryToken(Users), useValue: users },
        { provide: JwtAuthService, useValue: jwt },
        { provide: AuditLogsService, useValue: audit },
        { provide: YandexOauthService, useValue: oauth },
        { provide: PlatformService, useValue: platform },
        { provide: TenantContextService, useValue: context },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('only advertises explicitly allowed tenant hosts with configured credentials', () => {
    expect(service.getAuthProviders()).toEqual({ yandex: true });
    config.set('YANDEX_OAUTH_TENANT_HOSTS', 'another.example.test');
    expect(service.getAuthProviders()).toEqual({ yandex: false });
    expect(() => begin()).toThrow();
    config.set('YANDEX_OAUTH_TENANT_HOSTS', '');
    expect(service.getAuthProviders()).toEqual({ yandex: false });
    context.isEnabled.mockReturnValue(false);
    expect(service.getAuthProviders()).toEqual({ yandex: true });
    oauth.isConfigured.mockReturnValue(false);
    expect(service.getAuthProviders()).toEqual({ yandex: false });
  });

  it('uses the canonical HTTPS origin, signed state, host-only cookies and PKCE S256', () => {
    const req = request();
    req.headers['x-forwarded-host'] = 'attacker.example.test';
    const start = response();
    service.startYandexOAuth(start.res, req);
    expect(oauth.buildAuthorizeUrl).toHaveBeenCalledWith(
      start.cookies[TENANT_YANDEX_OAUTH_STATE_COOKIE], `https://${hostname}/api/auth/yandex/callback`, expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
    for (const name of [TENANT_YANDEX_OAUTH_STATE_COOKIE, TENANT_YANDEX_OAUTH_PKCE_COOKIE]) {
      expect(start.options[name]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600000 });
      expect(start.options[name].domain).toBeUndefined();
      expect(name.startsWith('__Host-')).toBe(true);
    }
  });

  it('rejects a foreign Host, Origin and SaaS linking before contacting the provider', () => {
    expect(() => service.startYandexOAuth(response().res, request({}, 'other.example.test'))).toThrow(ForbiddenException);
    const req = request();
    req.headers.origin = 'https://other.example.test';
    expect(() => service.startYandexOAuth(response().res, req)).toThrow(ForbiddenException);
    expect(() => service.startYandexOAuth(response().res, request(), true)).toThrow();
    expect(oauth.buildAuthorizeUrl).not.toHaveBeenCalled();
  });

  it('logs in only an existing provider binding and emits tenant-scoped claims', async () => {
    const start = begin();
    const finish = response();
    await service.handleYandexCallback(request(start.cookies), finish.res, { code: 'code', state: start.state });
    expect(users.findOneBy).toHaveBeenCalledWith({ yandex_id: 'provider-id' });
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
    expect(platform.assertMembership).toHaveBeenCalledWith(tenant.id, user.id);
    expect(oauth.exchangeCode).toHaveBeenCalledWith('code', `https://${hostname}/api/auth/yandex/callback`, start.cookies[TENANT_YANDEX_OAUTH_PKCE_COOKIE]);
    expect(jwt.generateToken).toHaveBeenCalledWith(expect.objectContaining({ id: user.id, tenantId: tenant.id, membershipId: membership.id, identityId: membership.identityId }));
    expect(finish.cookies.authToken).toBe('tenant-session-token');
    expect(finish.redirects).toEqual(['/']);
    expect(finish.cleared).toEqual(expect.arrayContaining([TENANT_YANDEX_OAUTH_STATE_COOKIE, TENANT_YANDEX_OAUTH_PKCE_COOKIE]));
  });

  it.each(['missing-user', 'archived-user', 'revoked-membership', 'role-mismatch', 'suspended-tenant'])('rejects %s without creating or linking an account', async (failure) => {
    const start = begin();
    if (failure === 'missing-user') users.findOneBy.mockResolvedValue(null);
    if (failure === 'archived-user') user.deletedAt = new Date();
    if (failure === 'revoked-membership' || failure === 'suspended-tenant') platform.assertMembership.mockRejectedValue(new ForbiddenException());
    if (failure === 'role-mismatch') membership.role = ROLES.employee;
    const finish = response();
    await service.handleYandexCallback(request(start.cookies), finish.res, { code: 'code', state: start.state });
    expect(finish.cookies.authToken).toBeUndefined();
    expect(jwt.generateToken).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
    expect(finish.redirects[0]).toMatch(/^\/login\?oauth_error=/);
  });

  it('rejects missing, cross-tenant and substituted state before code exchange', async () => {
    const start = begin();
    const missing = response();
    await service.handleYandexCallback(request({}), missing.res, { code: 'code', state: start.state });
    tenant = { ...tenant, id: 'another-tenant' };
    const foreign = response();
    await service.handleYandexCallback(request(start.cookies), foreign.res, { code: 'code', state: start.state });
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(jwt.generateToken).not.toHaveBeenCalled();
  });

  it('allows read-only membership login without changing local user credentials', async () => {
    tenant.readOnly = true;
    const start = begin();
    const finish = response();
    await service.handleYandexCallback(request(start.cookies), finish.res, { code: 'code', state: start.state });
    expect(finish.cookies.authToken).toBe('tenant-session-token');
    expect(users.update).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
  });

  it('does not issue a session for a provider error or reused authorization code', async () => {
    const start = begin();
    const denied = response();
    await service.handleYandexCallback(request(start.cookies), denied.res, { error: 'access_denied', state: start.state });
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    oauth.exchangeCode.mockRejectedValue(new Error('provider-secret-error-not-for-browser'));
    const reused = response();
    await service.handleYandexCallback(request(start.cookies), reused.res, { code: 'reused-code', state: start.state });
    expect(reused.cookies.authToken).toBeUndefined();
    expect(reused.redirects[0]).not.toContain('provider-secret');
    expect(jwt.generateToken).not.toHaveBeenCalled();
  });

  it('keeps the legacy self-hosted flow and linking cookie unchanged', async () => {
    context.isEnabled.mockReturnValue(false);
    const start = response();
    service.startYandexOAuth(start.res, request(), true);
    expect(start.cookies[YANDEX_OAUTH_LINK_COOKIE]).toBe('1');
    expect(start.cookies[TENANT_YANDEX_OAUTH_PKCE_COOKIE]).toBeUndefined();
    expect(oauth.buildAuthorizeUrl).toHaveBeenCalledWith(start.cookies[YANDEX_OAUTH_STATE_COOKIE], 'https://do-not-use.example.test/api/auth/yandex/callback');
    delete start.cookies[YANDEX_OAUTH_LINK_COOKIE];
    const finish = response();
    await service.handleYandexCallback(request(start.cookies), finish.res, { code: 'legacy-code', state: start.cookies[YANDEX_OAUTH_STATE_COOKIE] });
    expect(finish.cookies.authToken).toBe('tenant-session-token');
    expect(oauth.exchangeCode).toHaveBeenCalledWith('legacy-code', 'https://do-not-use.example.test/api/auth/yandex/callback');
    expect(platform.assertMembership).not.toHaveBeenCalled();
  });
});
