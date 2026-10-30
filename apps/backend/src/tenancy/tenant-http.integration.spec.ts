import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import type { Server as HttpServer } from 'http';
import { generateVAPIDKeys } from 'web-push';
import { hashIdentityPassword } from '../platform/password';
import { RedisIoAdapter } from '../websocket/redis-io.adapter';
import { PlatformService } from '../platform/platform.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantContextService } from './tenant-context.service';
import { TenantJobsService } from './tenant-jobs.service';

// Both databases must already have all migrations and dedicated runtime roles.
// Fixtures are retained for inspection and must never target an existing customer.
const dataUrl = process.env.TENANCY_HTTP_TEST_DATA_URL;
const platformUrl = process.env.TENANCY_HTTP_TEST_PLATFORM_URL;
const redisUrl = process.env.TENANCY_HTTP_TEST_REDIS_URL;
const integration = dataUrl && platformUrl && redisUrl ? describe : describe.skip;

integration('tenant HTTP isolation with the complete application', () => {
  let app: INestApplication;
  const previous: Record<string, string | undefined> = {};
  const suffix = randomBytes(5).toString('hex');
  const password = 'isolated-test-password-123';
  const adminHost = 'admin.example.test';
  const hostA = `http-a-${suffix}.example.test`;
  const hostB = `http-b-${suffix}.example.test`;
  let operatorCookie: string[];
  let cookieA: string[];
  let cookieB: string[];
  let tenantA: string;
  let tenantB: string;
  let projectA: number;

  function cookies(response: request.Response): string[] {
    const values = response.headers['set-cookie'];
    const byName = new Map<string, string>();
    for (const value of (Array.isArray(values) ? values : [values]) as string[]) {
      const cookie = value.split(';')[0];
      byName.set(cookie.slice(0, cookie.indexOf('=')), cookie);
    }
    return [...byName.values()];
  }

  function configure(key: string, value: string): void {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  beforeAll(async () => {
    for (const [prefix, connection] of [
      ['', dataUrl!],
      ['PLATFORM_', platformUrl!],
    ]) {
      const url = new URL(connection);
      if (!url.pathname.includes('_test')) throw new Error('HTTP integration requires dedicated _test databases');
      configure(`${prefix}POSTGRES_HOST`, url.hostname);
      configure(`${prefix}POSTGRES_PORT`, url.port);
      configure(`${prefix}POSTGRES_USER`, decodeURIComponent(url.username));
      configure(`${prefix}POSTGRES_PASSWORD`, decodeURIComponent(url.password) || 'ephemeral-test');
      configure(`${prefix}POSTGRES_DB`, url.pathname.slice(1));
    }
    const vapid = generateVAPIDKeys();
    configure('TENANCY_ENABLED', 'true');
    configure('NODE_ENV', 'test');
    configure('APP_DOMAIN', 'example.test');
    configure('TENANCY_ROOT_DOMAIN', 'example.test');
    configure('PLATFORM_ADMIN_HOST', adminHost);
    configure('PLATFORM_ADMIN_EMAIL', 'operator@example.test');
    configure('PLATFORM_ADMIN_PASSWORD_HASH', hashIdentityPassword(password));
    configure('JWT_SECRET', 'http-isolation-test-key-with-no-production-use');
    configure('TENANCY_PROXY_SECRET', 'http-isolation-test-proxy-key-with-no-production-use');
    configure('DATA_SHARDS_JSON', '');
    configure('REDIS_URL', redisUrl!);
    configure('PROXY_ENABLE', '0');
    configure('VAPID_PUBLIC_KEY', vapid.publicKey);
    configure('VAPID_PRIVATE_KEY', vapid.privateKey);
    const { AppModule } = await import('../app.module');
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    const adapter = new RedisIoAdapter(app);
    await adapter.connect(redisUrl!);
    app.useWebSocketAdapter(adapter);
    await app.listen(0, '127.0.0.1');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30_000);

  it('creates two spaces through the operator API and logs into each', async () => {
    const operator = await request(app.getHttpServer() as HttpServer)
      .post('/api/platform/auth/login')
      .set('Host', adminHost)
      .send({ email: 'operator@example.test', password })
      .expect(200);
    operatorCookie = cookies(operator);
    for (const host of [hostA, hostB]) {
      const tenant = await request(app.getHttpServer() as HttpServer)
        .post('/api/platform/tenants')
        .set('Host', adminHost)
        .set('Cookie', operatorCookie)
        .send({
          slug: host.split('.')[0],
          name: host,
          plan: 'test',
          seatLimit: 3,
          paidUntil: null,
          featureFlags: {},
          admin: { email: `admin@${host}`, firstName: 'Test', lastName: 'Admin', password, emailOwnershipVerified: true },
        })
        .expect(201);
      const login = await request(app.getHttpServer() as HttpServer)
        .post('/api/auth/login/email')
        .set('Host', host)
        .send({ email: `admin@${host}`, password })
        .expect(201);
      if (host === hostA) {
        tenantA = (tenant.body as { id: string }).id;
        cookieA = cookies(login);
      } else {
        tenantB = (tenant.body as { id: string }).id;
        cookieB = cookies(login);
      }
    }
  });

  it('commits project creation before responding and never returns another space data', async () => {
    const created = await request(app.getHttpServer() as HttpServer)
      .post('/api/projects')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .send({ name: 'Only space A' })
      .expect(201);
    projectA = (created.body as { id: number }).id;
    const own = await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .expect(200);
    expect((own.body as Array<{ id: number }>).some((row) => row.id === projectA)).toBe(true);
    const other = await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', hostB)
      .set('Cookie', cookieB)
      .expect(200);
    expect(other.body).toEqual([]);
    await request(app.getHttpServer() as HttpServer)
      .patch(`/api/projects/${projectA}`)
      .set('Host', hostB)
      .set('Cookie', cookieB)
      .send({ name: 'Cross tenant edit' })
      .expect(404);
  });

  it('rejects cross-space JWT, unknown Host, spoofed forwarding headers and cross-origin requests', async () => {
    await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', hostB)
      .set('Cookie', cookieA)
      .expect(401);
    await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', 'unregistered.example.test')
      .set('X-Forwarded-Host', hostA)
      .set('Cookie', cookieA)
      .expect(404);
    await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', hostA)
      .set('Origin', `https://${hostB}`)
      .set('Cookie', cookieA)
      .expect(403);
    await request(app.getHttpServer() as HttpServer)
      .get('/api/platform/tenants')
      .set('Host', hostA)
      .set('Cookie', operatorCookie)
      .expect(404);
    await request(app.getHttpServer() as HttpServer)
      .get('/api/Git/repos')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .expect(403);
  });

  it('requires explicit opt-in for mail, Git, voice and monitoring independently in each space', async () => {
    const endpoints = ['/api/mailbox/accounts', '/api/git/repos', '/api/voice/rooms', '/api/healthchecks'];
    const fixtures = [
      { id: tenantA, host: hostA, cookie: cookieA },
      { id: tenantB, host: hostB, cookie: cookieB },
    ];
    for (const fixture of fixtures) {
      for (const endpoint of endpoints) {
        await request(app.getHttpServer() as HttpServer)
          .get(endpoint)
          .set('Host', fixture.host)
          .set('Cookie', fixture.cookie)
          .expect(403);
      }
    }
    for (const fixture of fixtures) {
      await request(app.getHttpServer() as HttpServer)
        .patch(`/api/platform/tenants/${fixture.id}`)
        .set('Host', adminHost)
        .set('Cookie', operatorCookie)
        .send({ featureFlags: { mail: true, git: true, voice: true, healthchecks: true } })
        .expect(200);
      for (const endpoint of endpoints) {
        const response = await request(app.getHttpServer() as HttpServer)
          .get(endpoint)
          .set('Host', fixture.host)
          .set('Cookie', fixture.cookie)
          .expect(200);
        expect(response.body).toEqual([]);
      }
      // Enabling A must not implicitly enable any feature for B.
      if (fixture.id === tenantA) {
        for (const endpoint of endpoints) {
          await request(app.getHttpServer() as HttpServer)
            .get(endpoint)
            .set('Host', hostB)
            .set('Cookie', cookieB)
            .expect(403);
        }
      }
    }
  });

  it('keeps reads and sign-in working in read-only mode and blocks all business writes', async () => {
    await request(app.getHttpServer() as HttpServer)
      .patch(`/api/platform/tenants/${tenantA}`)
      .set('Host', adminHost)
      .set('Cookie', operatorCookie)
      .send({ status: 'read_only' })
      .expect(200);
    await request(app.getHttpServer() as HttpServer)
      .get('/api/projects')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .expect(200);
    const context = await request(app.getHttpServer() as HttpServer)
      .get('/api/tenant/context')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .expect(200);
    expect((context.body as { readOnly: boolean }).readOnly).toBe(true);
    await request(app.getHttpServer() as HttpServer)
      .post('/api/auth/login/email')
      .set('Host', hostA)
      .send({ email: `admin@${hostA}`, password })
      .expect(201);
    await request(app.getHttpServer() as HttpServer)
      .post('/api/projects')
      .set('Host', hostA)
      .set('Cookie', cookieA)
      .send({ name: 'Blocked' })
      .expect(403);
  });

  it('requires tenant context for jobs and deduplicates work within the selected tenant', async () => {
    // Resume only this test fixture; the read-only checks above remain independent.
    await request(app.getHttpServer() as HttpServer)
      .patch(`/api/platform/tenants/${tenantA}`)
      .set('Host', adminHost)
      .set('Cookie', operatorCookie)
      .send({ status: 'active' })
      .expect(200);
    const jobs = app.get(TenantJobsService);
    const context = app.get(TenantContextService);
    const database = app.get(TenantDatabaseService);
    const tenant = await app.get(PlatformService).getTenant(tenantA);
    const handled: string[] = [];
    jobs.register('http-test', (job) => {
      expect(context.require().tenant.id).toBe(job.tenant_id);
      handled.push(job.idempotency_key);
      return Promise.resolve();
    });
    await expect(jobs.enqueue('http-test', 'missing-tenant')).rejects.toThrow();
    await database.run(tenant, async () => {
      await jobs.enqueue('http-test', 'same-key', {});
      await jobs.enqueue('http-test', 'same-key', {});
      await jobs.enqueue('http-test', 'invalid-shard', {});
      await context
        .require()
        .manager.query("UPDATE tenant_jobs SET database_shard_id = 'other_shard' WHERE idempotency_key = 'invalid-shard'");
    });
    await jobs.tick();
    expect(handled).toEqual(['same-key']);
    await database.run(tenant, async () => {
      const rows = await context
        .require()
        .manager.query<
          Array<{ idempotency_key: string; status: string }>
        >("SELECT idempotency_key, status FROM tenant_jobs WHERE kind = 'http-test' ORDER BY idempotency_key");
      expect(rows).toEqual([
        { idempotency_key: 'invalid-shard', status: 'failed' },
        { idempotency_key: 'same-key', status: 'completed' },
      ]);
    });
  });
});
