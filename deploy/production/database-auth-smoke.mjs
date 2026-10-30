// Explicit local-only test: no application data, external network or published ports.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProduction } from './validate.mjs';

const [postgresImage, poolImage] = process.argv.slice(2);
for (const image of [postgresImage, poolImage]) assert.match(image || '', /^sha256:[a-f0-9]{64}$/, 'Pass exact locally cached PostgreSQL and PgBouncer image IDs');
const root = mkdtempSync(join(tmpdir(), 'nervion-database-auth-smoke-'));
chmodSync(root, 0o700);
const project = `nervion-auth-${randomUUID()}`;
const composePath = join(root, 'compose.json');
const env = { PATH: process.env.PATH, HOME: process.env.HOME };
const docker = (args, { timeout = 30_000, input } = {}) => spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env, input, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
});
const requireSuccess = (result, message) => { assert.equal(result.status, 0, message); return result.stdout.trim(); };
const compose = (...args) => docker(['compose', '--project-name', project, '-f', composePath, ...args], { timeout: 100_000 });
const secretNames = ['postgres_password', 'data_password', 'platform_password', 'data_migrator_password', 'platform_migrator_password', 'pgbackrest_config'];
let prepared = false;
let failure;
try {
  for (const image of [postgresImage, poolImage]) {
    assert.equal(requireSuccess(docker(['image', 'inspect', image, '--format', '{{.Id}}']), 'Required exact image is not cached locally'), image);
  }
  for (const name of secretNames) {
    const value = randomBytes(32).toString('hex');
    writeFileSync(join(root, name), value, { mode: 0o400 });
    if (['data_password', 'platform_password'].includes(name)) writeFileSync(join(root, `bootstrap_${name}`), value, { mode: 0o400 });
  }
  // Docker owns only generated fixture files here, never an existing secrets directory.
  requireSuccess(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
    '--mount', `type=bind,source=${root},target=/fixture`, '--entrypoint', '/bin/sh', postgresImage, '-ec',
    'chown 10001:0 /fixture/data_password /fixture/platform_password; chown 999:0 /fixture/data_migrator_password /fixture/platform_migrator_password; chown 999:999 /fixture/bootstrap_data_password /fixture/bootstrap_platform_password /fixture/postgres_password /fixture/pgbackrest_config; chmod 0400 /fixture/*; chmod 0440 /fixture/data_password /fixture/platform_password /fixture/data_migrator_password /fixture/platform_migrator_password; cmp /fixture/data_password /fixture/bootstrap_data_password; cmp /fixture/platform_password /fixture/bootstrap_platform_password']), 'Cannot establish private fixture secret ownership');
  const rootRead = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '0:0',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'];
  for (const name of ['data_password', 'platform_password', 'data_migrator_password', 'platform_migrator_password']) {
    rootRead.push('--mount', `type=bind,source=${join(root, name)},target=/run/secrets/${name},readonly`);
  }
  rootRead.push('--entrypoint', '/bin/sh', postgresImage, '-ec',
    'test "$(id -u):$(id -g)" = 0:0; grep -Eq "^CapEff:[[:space:]]+0+$" /proc/self/status; for name in data_password platform_password data_migrator_password platform_migrator_password; do test -s "/run/secrets/$name"; test "$(wc -c < "/run/secrets/$name")" = 64; done');
  requireSuccess(docker(rootRead), 'Root runtime without capabilities cannot read shared password files');
  const fixtureEnv = { ...env,
    PRODUCTION_PROJECT_NAME: project, PRODUCTION_POSTGRES_IMAGE: postgresImage, PRODUCTION_PGBOUNCER_IMAGE: poolImage,
    PRODUCTION_REDIS_IMAGE: postgresImage, PRODUCTION_BACKEND_IMAGE: postgresImage, PRODUCTION_FRONTEND_IMAGE: postgresImage, PRODUCTION_GATEWAY_IMAGE: postgresImage,
    PRODUCTION_ROOT_DOMAIN: 'example.test', PRODUCTION_ADMIN_HOST: 'admin.example.test', PRODUCTION_ADMIN_EMAIL: 'admin@example.test', PRODUCTION_INGRESS_BIND_IP: '127.0.0.1',
    PRODUCTION_STORAGE_ENDPOINT: 'https://storage.example.test', PRODUCTION_STORAGE_REGION: 'fixture', PRODUCTION_STORAGE_BUCKET: 'fixture',
    PRODUCTION_PGBOUNCER_PORT: '16432', PRODUCTION_REDIS_PORT: '16379', PRODUCTION_BACKEND_PORT: '13026', PRODUCTION_FRONTEND_PORT: '13012', PRODUCTION_HTTP_PORT: '13088',
    PRODUCTION_BOOTSTRAP_TENANT_ID: '11111111-1111-4111-8111-111111111111', PRODUCTION_MEDIA_PUBLIC_IP: '192.0.2.1', PRODUCTION_MEDIA_MIN_PORT: '40000', PRODUCTION_MEDIA_MAX_PORT: '49999',
    PRODUCTION_EXTERNAL_GIT_ROOT: root, PRODUCTION_SMTP_TLS_DIR: root, PRODUCTION_SMTP_HOST: 'mail.example.test', PRODUCTION_SMTP_PORT: '2525',
    PRODUCTION_SECRETS_DIR: root, PRODUCTION_TENANT_JOBS_ENABLED: 'false', PRODUCTION_DEPLOYMENT_PHASE: 'precutover' };
  const rendered = spawnSync('docker', ['compose', '-f', fileURLToPath(new URL('./compose.yml', import.meta.url)), '--profile', 'deployment', '--profile', 'backup', 'config', '--format', 'json'], {
    env: fixtureEnv, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  const config = JSON.parse(requireSuccess(rendered, 'Cannot render production Compose fixture'));
  validateProduction(config, project, 'precutover');
  config.services = { postgres: config.services.postgres, pgbouncer: config.services.pgbouncer };
  config.volumes = { postgres_data: config.volumes.postgres_data, postgres_socket: config.volumes.postgres_socket };
  config.networks = { database: { internal: true } };
  const mountedSecrets = new Set(Object.values(config.services).flatMap((service) => service.secrets.map((secret) => secret.source)));
  config.secrets = Object.fromEntries(Object.entries(config.secrets).filter(([name]) => mountedSecrets.has(name)));
  for (const service of Object.values(config.services)) {
    service.networks = { database: null };
    service.restart = 'no';
    delete service.ports;
    service.labels = { 'io.nervion.fixture': project };
  }
  // This fixture verifies initial roles/secrets/auth only. WAL/backup is covered by postgres/fixture.mjs.
  config.services.postgres.command = ['postgres', '-c', 'password_encryption=scram-sha-256', '-c', 'shared_preload_libraries=pg_stat_statements'];
  writeFileSync(composePath, JSON.stringify(config), { mode: 0o600 });
  prepared = true;
  requireSuccess(compose('up', '--detach', '--wait', '--wait-timeout', '90', '--no-build', '--pull', 'never', 'postgres', 'pgbouncer'), 'Fresh PostgreSQL/PgBouncer did not become healthy');
  const ids = {};
  for (const name of ['postgres', 'pgbouncer']) {
    ids[name] = requireSuccess(compose('ps', '--quiet', name), `Missing fixture ${name}`);
    assert.match(ids[name], /^[a-f0-9]{64}$/);
    const state = JSON.parse(requireSuccess(docker(['inspect', ids[name]]), 'Cannot inspect fixture boundary'))[0];
    assert.equal(state.Config.Labels['com.docker.compose.project'], project);
    assert.equal(state.Config.Labels['io.nervion.fixture'], project);
    assert.equal(state.HostConfig.PortBindings && Object.keys(state.HostConfig.PortBindings).length || 0, 0);
    for (const secret of ['data_password', 'platform_password']) {
      const mount = state.Mounts.find((entry) => entry.Destination === `/run/secrets/${secret}`);
      assert.equal(mount?.Source, join(root, name === 'postgres' ? `bootstrap_${secret}` : secret));
      assert.equal(mount.RW, false);
    }
  }
  const exec = (name, user, script) => docker(['exec', '--user', user, ids[name], '/bin/sh', '-ec', script]);
  requireSuccess(exec('postgres', '999:999', 'test "$(stat -c %u:%g:%a /run/secrets/data_password)" = 999:999:400; test "$(stat -c %u:%g:%a /run/secrets/platform_password)" = 999:999:400; test -r /run/secrets/data_password; test -r /run/secrets/platform_password'), 'PostgreSQL bootstrap secret access failed');
  requireSuccess(exec('pgbouncer', '10001:10001', 'test "$(stat -c %u:%g:%a /run/secrets/data_password)" = 10001:0:440; test "$(stat -c %u:%g:%a /run/secrets/platform_password)" = 10001:0:440; test "$(id -u)" = 10001'), 'PgBouncer secret access failed');
  for (const [role, database, secret, other] of [
    ['nervion_data', 'nervion_data_1', 'data_password', 'nervion_platform'],
    ['nervion_platform', 'nervion_platform', 'platform_password', 'nervion_data_1'],
  ]) {
    const command = `psql -w -XAt -h 127.0.0.1 -p 6432 -U ${role}`;
    const login = `PGCONNECT_TIMEOUT=5 PGPASSWORD="$(cat /run/secrets/${secret})" ${command}`;
    assert.equal(requireSuccess(exec('pgbouncer', '10001:10001', `${login} -d ${database} -c 'SELECT current_user, current_database(), rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user'`), 'Runtime SQL login failed'), `${role}|${database}|f|f`);
    assert.notEqual(exec('pgbouncer', '10001:10001', `PGCONNECT_TIMEOUT=5 PGPASSWORD=deliberately-wrong-fixture-password ${command} -d ${database} -c 'SELECT 1'`).status, 0, 'Wrong password was accepted');
    assert.notEqual(exec('pgbouncer', '10001:10001', `${login} -d ${other} -c 'SELECT 1'`).status, 0, 'Cross-database runtime login was accepted');
  }
  const hashes = requireSuccess(exec('postgres', '999:999', 'psql -w -XAt -U postgres -d postgres -c "SELECT count(*) FROM pg_authid WHERE rolname IN (\'nervion_data\',\'nervion_platform\') AND rolpassword LIKE \'SCRAM-SHA-256$%\'"'), 'Cannot verify SCRAM password storage');
  assert.equal(hashes, '2');
  console.log('Fresh PostgreSQL init and both PgBouncer SCRAM logins passed; private UID aliases, group-0 root reads without capabilities, wrong-password and cross-database rejection verified');
} catch (error) {
  failure = error;
} finally {
  const stopped = !prepared || compose('down', '--volumes', '--timeout', '10').status === 0;
  if (stopped) rmSync(root, { recursive: true });
  else failure ||= new Error('Fixture cleanup failed; inspect only the private fixture project');
}
if (failure) throw failure;
