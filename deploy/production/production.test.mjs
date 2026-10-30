import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runtimeEnvironment, port, hostname, ingressBindAddress } from './config.mjs';
import { assertBaseline, baseline, checkMigrationClient, migrationEnvironment, migrationSources } from './migrate.mjs';
import { assertPrecutoverSnapshot, checkPrecutoverClient } from './preflight.mjs';
import { validateProduction } from './validate.mjs';

const tenant = '11111111-1111-4111-8111-111111111111';
const common = { NODE_ENV: 'production', NERVION_DEPLOYMENT_PHASE: 'precutover', TENANCY_BOOTSTRAP_TENANT_ID: tenant,
  TENANCY_ENABLED: 'true', POSTGRES_DB: 'nervion_data_1', POSTGRES_USER: 'nervion_data',
  PLATFORM_POSTGRES_DB: 'nervion_platform', PLATFORM_POSTGRES_USER: 'nervion_platform',
  POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '16432', PLATFORM_POSTGRES_HOST: '127.0.0.1', PLATFORM_POSTGRES_PORT: '16432',
  AWS_ENDPOINT: 'https://storage.example.test', PUSH_ENABLED: 'false', AI_ENABLED: 'false',
  TENANT_JOBS_WORKER_ENABLED: 'false', PLATFORM_ADMIN_HOST: 'admin.example.test' };
const backend = { ...common, PORT: '13026', BACKEND_BIND_HOST: '127.0.0.1', REDIS_HOST: '127.0.0.1', REDIS_PORT: '16379',
  MEDIASOUP_ANNOUNCED_IP: '192.0.2.1', MEDIASOUP_MIN_PORT: '40000', MEDIASOUP_MAX_PORT: '49999' };
const secret = () => 'fixture-only-not-a-real-secret';

test('runtime strips migration credentials and preserves the supplied legacy JWT secret', () => {
  const env = runtimeEnvironment('backend', { ...backend, MIGRATION_POSTGRES_PASSWORD: 'must-not-survive', PLATFORM_MIGRATION_POSTGRES_PASSWORD: 'must-not-survive' }, secret);
  assert.equal(env.JWT_SECRET, secret()); assert.equal(env.MIGRATION_POSTGRES_PASSWORD, undefined);
  assert.equal(env.PLATFORM_MIGRATION_POSTGRES_PASSWORD, undefined);
  assert.match(env.REDIS_URL, /@127\.0\.0\.1:16379\/0$/);
});

test('backend refuses public HTTP, hostnames, non-tenant runtime and active staging workers', () => {
  for (const values of [{ BACKEND_BIND_HOST: '0.0.0.0' }, { POSTGRES_HOST: 'postgres' }, { TENANCY_ENABLED: 'false' },
    { TENANT_JOBS_WORKER_ENABLED: 'true' }, { NERVION_DEPLOYMENT_PHASE: 'unknown' }, { POSTGRES_USER: 'postgres' },
    { MEDIASOUP_MIN_PORT: '13000', MEDIASOUP_MAX_PORT: '14000' }, { AWS_ENDPOINT: 'http://storage.example.test' }]) {
    assert.throws(() => runtimeEnvironment('backend', { ...backend, ...values }, secret));
  }
});

test('SMTP uses certificate bundle paths and does not load admin, Git or voice secrets', () => {
  const requested = [];
  const env = runtimeEnvironment('smtp', { ...common, SMTP_PORT: '2525', SMTP_TLS_SERVER_NAME: 'mail.example.test',
    SMTP_TLS_CERT_FILE: '/run/nervion/smtp-tls/current/fullchain.pem', SMTP_TLS_KEY_FILE: '/run/nervion/smtp-tls/current/privkey.pem' }, (name) => { requested.push(name); return secret(); });
  assert.ok(requested.includes('jwt_secret')); assert.equal(env.TENANT_JOBS_WORKER_ENABLED, 'false');
  assert.equal(requested.some((name) => /admin|git_|turn_/.test(name)), false);
});

test('frontend is loopback-only and receives only the tenancy proxy secret', () => {
  const requested = [];
  const env = { NODE_ENV: 'production', NERVION_DEPLOYMENT_PHASE: 'precutover', NUXT_PUBLIC_TENANCY_ENABLED: 'true', NITRO_HOST: '127.0.0.1', PORT: '13012', NUXT_PUBLIC_PLATFORM_ADMIN_HOST: 'admin.example.test' };
  runtimeEnvironment('frontend', env, (name) => { requested.push(name); return secret(); });
  assert.deepEqual(requested, ['tenancy_proxy_secret']);
  assert.throws(() => runtimeEnvironment('frontend', { ...env, NITRO_HOST: '0.0.0.0' }, secret));
});

test('rejects ports and hostname injection', () => {
  for (const value of ['0', '65536', '12x', '01', '30\n80']) assert.throws(() => port(value, 'test'));
  for (const value of ['a..test', '*.example.test', 'https://example.test', 'example.test; listen 80;', 'example.test\n']) assert.throws(() => hostname(value, 'test'));
});

test('ingress permits only explicit loopback or RFC1918 IPv4 addresses', () => {
  for (const value of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.254', '192.168.2.1']) assert.equal(ingressBindAddress(value), value);
  for (const value of [undefined, '', '0.0.0.0', '127.0.0.2', '172.15.0.1', '172.32.0.1', '192.169.0.1', '192.168.1.256', '192.168.01.1', '10.1', '::1', '192.0.2.1', 'host.docker.internal', '10.1.1.1;listen 80']) assert.throws(() => ingressBindAddress(value));
});

test('migration job never includes legacy DataSource and requires dedicated roles', () => {
  assert.deepEqual(migrationSources, ['dist/platform/platform-data-source.js', 'dist/tenant-data-source.js']);
  const env = { ...common, MIGRATION_POSTGRES_HOST: 'postgres', MIGRATION_POSTGRES_PORT: '5432', MIGRATION_POSTGRES_USER: 'nervion_data_migrator',
    PLATFORM_MIGRATION_POSTGRES_HOST: 'postgres', PLATFORM_MIGRATION_POSTGRES_PORT: '5432', PLATFORM_MIGRATION_POSTGRES_USER: 'nervion_platform_migrator' };
  assert.equal(migrationEnvironment(env, secret).MIGRATION_POSTGRES_PASSWORD, secret());
  for (const change of [{ MIGRATION_POSTGRES_USER: 'postgres' }, { MIGRATION_POSTGRES_HOST: '127.0.0.1' }, { TENANCY_BOOTSTRAP_TENANT_ID: '' }]) assert.throws(() => migrationEnvironment({ ...env, ...change }, secret));
});

test('baseline v1 is explicit, rejects missing schema/ownership and tolerates later unrelated records', () => {
  const applied = baseline.requiredMigrationTimestamps.map((timestamp) => ({ timestamp }));
  const tables = baseline.requiredBusinessTables.map((name) => ({ name, owner: 'nervion_data_migrator' }));
  assertBaseline([...applied, { timestamp: '9999999999999' }], tables);
  assert.throws(() => assertBaseline(applied.slice(1), tables));
  assert.throws(() => assertBaseline(applied, tables.slice(1)));
  assert.throws(() => assertBaseline(applied, [...tables, { name: 'platform_tenants', owner: 'nervion_data_migrator' }]));
  assert.throws(() => assertBaseline(applied, [{ ...tables[0], owner: 'nervion_data' }, ...tables.slice(1)]));
});

test('migration preflight needs no global settings grant and still rejects wrong roles and missing extension', async () => {
  const row = { database: 'nervion_data_1', username: 'nervion_data_migrator', owner: 'nervion_data_migrator', privileged: false };
  const makeClient = (value = row, count = 1) => ({ query: async (query) => {
    assert.doesNotMatch(query, /current_setting|pg_read_all_settings/);
    return { rows: [query.includes('pg_extension') ? { count } : value] };
  } });
  await checkMigrationClient(makeClient(), row.database, row.username);
  for (const changed of [null, { ...row, privileged: true }, { ...row, owner: 'postgres' }, { ...row, database: 'other' }, { ...row, username: 'postgres' }]) {
    await assert.rejects(checkMigrationClient(makeClient(changed), row.database, row.username));
  }
  await assert.rejects(checkMigrationClient(makeClient(row, 0), row.database, row.username));
});

test('precutover checks actual platform state, including bootstrap identity and all tenant flags', async () => {
  for (const row of [null, { total: 0, safe: true, bootstrap: true }, { total: 1, safe: false, bootstrap: true }, { total: 1, safe: true, bootstrap: false }]) assert.throws(() => assertPrecutoverSnapshot(row));
  let query;
  await checkPrecutoverClient({ query: async (sql, params) => { query = { sql, params }; return { rows: [{ total: 1, safe: true, bootstrap: true }] }; } }, tenant);
  assert.match(query.sql, /status='read_only'/); assert.match(query.sql, /"mail":false/); assert.deepEqual(query.params, [tenant]);
});

test('rendered production Compose is isolated, immutable and fails unsafe alterations', () => {
  const image = `sha256:${'a'.repeat(64)}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME,
    PRODUCTION_PROJECT_NAME: 'fixture-production', PRODUCTION_POSTGRES_IMAGE: image, PRODUCTION_PGBOUNCER_IMAGE: image,
    PRODUCTION_REDIS_IMAGE: image, PRODUCTION_BACKEND_IMAGE: image, PRODUCTION_FRONTEND_IMAGE: `sha256:${'b'.repeat(64)}`, PRODUCTION_GATEWAY_IMAGE: image,
    PRODUCTION_ROOT_DOMAIN: 'example.test', PRODUCTION_ADMIN_HOST: 'admin.example.test', PRODUCTION_ADMIN_EMAIL: 'admin@example.test', PRODUCTION_INGRESS_BIND_IP: '127.0.0.1',
    PRODUCTION_STORAGE_ENDPOINT: 'https://storage.example.test', PRODUCTION_STORAGE_REGION: 'fixture', PRODUCTION_STORAGE_BUCKET: 'fixture',
    PRODUCTION_PGBOUNCER_PORT: '16432', PRODUCTION_REDIS_PORT: '16379', PRODUCTION_BACKEND_PORT: '13026', PRODUCTION_FRONTEND_PORT: '13012', PRODUCTION_HTTP_PORT: '13088',
    PRODUCTION_BOOTSTRAP_TENANT_ID: tenant, PRODUCTION_MEDIA_PUBLIC_IP: '192.0.2.1', PRODUCTION_MEDIA_MIN_PORT: '40000', PRODUCTION_MEDIA_MAX_PORT: '49999',
    PRODUCTION_EXTERNAL_GIT_ROOT: '/tmp', PRODUCTION_SMTP_TLS_DIR: '/tmp', PRODUCTION_SMTP_HOST: 'mail.example.test', PRODUCTION_SMTP_PORT: '2525',
    PRODUCTION_SECRETS_DIR: '/tmp', PRODUCTION_TENANT_JOBS_ENABLED: 'false', PRODUCTION_DEPLOYMENT_PHASE: 'precutover' };
  const result = spawnSync('docker', ['compose', '-f', fileURLToPath(new URL('./compose.yml', import.meta.url)), '--profile', 'deployment', '--profile', 'backup', 'config', '--format', 'json'], { env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  const compose = JSON.parse(result.stdout);
  assert.equal(validateProduction(compose, 'fixture-production', 'precutover'), true);
  assert.equal(compose.services.backend.environment.OPENROUTER_MODEL, 'google/gemini-2.0-flash-001');
  assert.equal(compose.services.backend.environment.OPENROUTER_TRANSCRIBE_MODEL, 'openai/whisper-large-v3-turbo');
  const privateInterface = structuredClone(compose);
  privateInterface.services.gateway.environment.PRODUCTION_INGRESS_BIND_IP = '172.20.0.1';
  assert.equal(validateProduction(privateInterface, 'fixture-production', 'precutover'), true);
  for (const mutate of [
    (c) => { c.services.postgres.ports = [{ published: '5432', target: 5432 }]; },
    (c) => { c.services.postgres.secrets.find((v) => v.target === 'data_password').source = 'data_password'; },
    (c) => { c.services.pgbouncer.secrets[0].source = 'bootstrap_data_password'; },
    (c) => { c.services.pgbouncer.user = '0:0'; },
    (c) => { c.services.migrate.cap_add = ['DAC_OVERRIDE']; },
    (c) => { c.secrets.bootstrap_platform_password.file = c.secrets.platform_password.file; },
    (c) => { c.services.backend.environment.BACKEND_BIND_HOST = '0.0.0.0'; },
    (c) => { c.services.redis.ports[0].host_ip = '0.0.0.0'; },
    (c) => { c.services.backend.environment.TENANT_JOBS_WORKER_ENABLED = 'true'; },
    (c) => { c.services.smtp.ports[0].published = '25'; },
    (c) => { c.services.backend.image = 'backend:latest'; },
    (c) => { c.services.backend.secrets.push({ source: 'data_migrator_password' }); },
    (c) => { c.services.backend.volumes.find((v) => v.target === '/var/git').read_only = false; },
    (c) => { c.volumes.postgres_data.name = 'existing_shared_database'; },
    (c) => { c.services.gateway.environment.PRODUCTION_INGRESS_BIND_IP = '0.0.0.0'; },
    (c) => { c.services.gateway.user = '0:0'; },
    (c) => { c.services.gateway.cap_add = ['CHOWN']; },
    (c) => { c.services.gateway.tmpfs[0] = '/var/cache/nginx:size=16m'; },
  ]) { const changed = structuredClone(compose); mutate(changed); assert.throws(() => validateProduction(changed, 'fixture-production', 'precutover')); }
  const gateway = readFileSync(new URL('./gateway.conf.template', import.meta.url), 'utf8');
  assert.equal(gateway.match(/listen \$\{PRODUCTION_INGRESS_BIND_IP\}:/g)?.length, 2);
  assert.match(gateway, /X-Nervion-Signature ""/);
});
