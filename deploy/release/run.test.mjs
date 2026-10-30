import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const runner = join(directory, 'run.sh');
const commit = '1'.repeat(40);
const backend = `sha256:${'a'.repeat(64)}`;
const frontend = `sha256:${'b'.repeat(64)}`;
const fakeDocker = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.HOME;
const options = JSON.parse(fs.readFileSync(path.join(home,'options.json'),'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(home,'commands.jsonl'),JSON.stringify(args)+'\\n');
if (args[0] !== '--host' || args[1] !== 'unix:///var/run/docker.sock') process.exit(91);
args.splice(0,2);
const commit = '1'.repeat(40);
const backend = 'sha256:'+'a'.repeat(64);
const frontend = 'sha256:'+'b'.repeat(64);
const storeFile = path.join(home,'containers.json');
const store = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile,'utf8')) : {};
const save = () => fs.writeFileSync(storeFile,JSON.stringify(store));
const value = (name) => args[args.indexOf(name)+1];
if (args[0] === 'image' && args[1] === 'inspect') {
 const ref = args[2];
 const id = ref === frontend ? frontend : backend;
 console.log(JSON.stringify({Id:id,Config:{Labels:{'org.opencontainers.image.revision':options.wrongRevision?'2'.repeat(40):commit}}}));
 process.exit(0);
}
if (args[0] === 'container') {
 const action = args[1];
 if (action === 'logs') { console.log('Migration fixture completed'); process.exit(0); }
 if (action === 'ls') { if(options.activeMigration) console.log('d'.repeat(64)); process.exit(0); }
 if (action === 'inspect') {
  const found = store[args[2]] || Object.values(store).find(c=>c.Id===args[2]);
  if (!found) process.exit(1);
  console.log(JSON.stringify(found)); process.exit(0);
 }
 if (action === 'stop' || action === 'rm') {
  const name = args.at(-1); const found = store[name];
  if(!found) process.exit(1);
  if(action === 'rm') delete store[name]; else found.State={Status:'exited',ExitCode:143};
  save(); process.exit(0);
 }
 process.exit(92);
}
if (args[0] !== 'compose') process.exit(93);
const project = value('--project-name');
const files = args.flatMap((a,i)=>a==='-f'?[args[i+1]]:[]);
let config = {};
for(const file of files) {
 const next=JSON.parse(fs.readFileSync(file,'utf8'));
 config={...config,...next,services:{...config.services}};
 for(const [key,service] of Object.entries(next.services||{})) {
  const prev=config.services[key]||{};
  config.services[key]={...prev,...service,labels:{...prev.labels,...service.labels}};
 }
}
config.name=project;
const operation=['config','run','up','ps'].find(a=>args.includes(a));
if (operation === 'config') { console.log(JSON.stringify(config)); process.exit(0); }
const create = (name, service, state, id) => ({Id:id,Image:config.services[service].image,
 Config:{Labels:{...config.services[service].labels,'com.docker.compose.project':project,'com.docker.compose.service':service}},State:state});
if (operation === 'run') {
 if(options.runFailure) process.exit(17);
 const name=value('--name');
 store[name]=create(name,'migrate',{Status:'exited',ExitCode:options.migrationFailure?7:0},'d'.repeat(64));
 save();console.log('d'.repeat(64));process.exit(0);
}
if (operation === 'up') {
 if(options.upFailure) process.exit(19);
 const selected=args.slice(args.indexOf('--wait-timeout')+2);
 for(const [i,service] of selected.entries()) {
  store[service]=create(service,service,{Status:'running',Health:{Status:options.healthFailure?'unhealthy':'healthy'}},String(i+1).repeat(64));
  if(options.wrongContainerImage) store[service].Image='sha256:'+'e'.repeat(64);
 }
 save(); process.exit(0);
}
if(operation === 'ps') { const found=store[args.at(-1)];if(found)console.log(found.Id);process.exit(0); }
process.exit(94);
`;

function fixture(t, options = {}) {
  // Root execution intentionally rejects inputs beneath writable /tmp.
  const root = mkdtempSync(join(process.getuid?.() === 0 ? homedir() : tmpdir(), 'nervion-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, 'docker'), fakeDocker, { mode: 0o700 });
  const write = (name, value) => writeFileSync(join(root, name), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  write('options.json', options);
  write('production.env', 'PRIVATE_VALUE=not-for-output\n');
  const service = { image: 'unused:mutable', environment: { TENANCY_ENABLED: 'true' }, healthcheck: { test: ['CMD', 'true'] } };
  write('compose.json', { services: {
    backend: service, frontend: service, smtp: service,
    migrate: { image: 'unused:mutable', environment: { TENANCY_ENABLED: 'true' }, labels: { 'io.nervion.release.migration': 'tenant-only' } },
    postgres: { image: 'postgres:17' }, proxy: { image: 'caddy:2' }, redis: { image: 'redis:7' },
  } });
  const manifest = { schemaVersion: 1, commit, project: 'test-saas-release', composeFile: join(root, 'compose.json'),
    envFile: join(root, 'production.env'), images: { backend, frontend }, services: ['backend', 'frontend'], healthTimeoutSeconds: 5, migrationTimeoutSeconds: 30 };
  write('manifest.json', manifest);
  const execute = action => spawnSync('bash', [runner, action, '--manifest', join(root, 'manifest.json'), '--state-dir', join(root, 'state'),
    '--project', manifest.project, '--expected-commit', commit], { encoding: 'utf8', env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` }, timeout: 20000 });
  const commands = () => {
    try { return readFileSync(join(root, 'commands.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
  };
  const success = action => { const result = execute(action); assert.equal(result.status, 0, result.stderr + result.stdout); return result; };
  const failure = action => { const result = execute(action); assert.notEqual(result.status, 0, result.stdout); assert.doesNotMatch(result.stdout + result.stderr, /not-for-output/); return result; };
  return { root, manifest, write, execute, success, failure, commands };
}

function productionFixture(f) {
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  const tenant = '11111111-1111-4111-8111-111111111111';
  for (const name of ['backend', 'frontend', 'migrate', 'smtp']) config.services[name].environment = {
    ...config.services[name].environment, NERVION_DEPLOYMENT_PHASE: 'precutover',
    TENANCY_BOOTSTRAP_TENANT_ID: tenant, TENANT_JOBS_WORKER_ENABLED: 'false',
  };
  config.services.backend.labels = { 'io.nervion.release.production': 'true' };
  config.services.backend.network_mode = 'host'; config.services.frontend.network_mode = 'host';
  config.services.backend.environment.BACKEND_BIND_HOST = '127.0.0.1';
  config.services.frontend.environment.NITRO_HOST = '127.0.0.1';
  f.write('compose.json', config);
  const evidence = { schemaVersion: 1, project: f.manifest.project, commit, phase: 'precutover', bootstrapTenantId: tenant,
    checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), expiresAt: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    checks: { privateIngressVerified: true, backupRestoreVerified: true, legacyStillPrimary: true, noVoiceJoins: true },
    checkpoints: { backupId: 'fixture-backup', restoreVerificationId: 'fixture-restore', storageCheckpoint: 'fixture-storage' } };
  f.write('evidence.json', evidence);
  f.manifest.dataState = { phase: 'precutover', evidenceFile: join(f.root, 'evidence.json') };
  f.write('manifest.json', f.manifest);
  return { config, evidence };
}

test('selected secrets preserve their kind and name in receipts and are rehashed before deploy', t => {
  const f = fixture(t);
  f.write('database-password', 'fixture-password');
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  config.secrets = { data_password: { file: join(f.root, 'database-password') } };
  config.services.backend.secrets = [{ source: 'data_password', target: 'data_password' }];
  f.write('compose.json', config);
  f.success('prepare'); f.success('migrate');
  const head = JSON.parse(readFileSync(join(f.root, 'state', f.manifest.project, 'prepared-head.json')));
  const receipt = JSON.parse(readFileSync(join(head.release, 'prepared.json')));
  assert.ok(receipt.inputs.some(input => input.path === join(f.root, 'database-password') && input.kind === 'secret' && input.secretName === 'data_password'));
  f.write('database-password', 'changed-password');
  f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('a selected secret cannot silently be skipped as a mutable data directory', t => {
  const f = fixture(t);
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  config.secrets = { data_password: { file: f.root } };
  config.services.backend.secrets = ['data_password']; f.write('compose.json', config);
  f.failure('prepare');
});

test('production requires a phase-bound evidence file', t => {
  const f = fixture(t); productionFixture(f);
  delete f.manifest.dataState; f.write('manifest.json', f.manifest);
  f.failure('prepare');
  assert.equal(f.commands().some(c => c.includes('up') || c.includes('run')), false);
});

test('production rejects stale evidence', t => {
  const f = fixture(t); const { evidence } = productionFixture(f);
  evidence.checkedAt = '2020-01-01T00:00:00Z'; evidence.expiresAt = '2020-01-01T01:00:00Z'; f.write('evidence.json', evidence);
  f.failure('prepare');
});

test('production rejects evidence for another tenant, phase or commit', t => {
  for (const field of ['bootstrapTenantId', 'phase', 'commit']) {
    const f = fixture(t); const { evidence } = productionFixture(f);
    evidence[field] = field === 'phase' ? 'live' : 'wrong'; f.write('evidence.json', evidence); f.failure('prepare');
  }
});

test('production evidence is hashed and cannot change between migration and deployment', t => {
  const f = fixture(t); const { evidence } = productionFixture(f);
  f.success('prepare'); f.success('migrate');
  evidence.checkpoints.backupId = 'changed'; f.write('evidence.json', evidence);
  f.failure('deploy'); assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('production refuses bootstrap-schema command in the normal release job', t => {
  const f = fixture(t); const { config } = productionFixture(f);
  config.services.migrate.command = ['--bootstrap-schema']; f.write('compose.json', config); f.failure('prepare');
});

test('production live evidence requires all stopped legacy writers', t => {
  const f = fixture(t); const { config, evidence } = productionFixture(f);
  for (const name of ['backend', 'frontend', 'migrate', 'smtp']) config.services[name].environment.NERVION_DEPLOYMENT_PHASE = 'live';
  f.write('compose.json', config); f.manifest.dataState.phase = 'live'; f.write('manifest.json', f.manifest);
  evidence.phase = 'live'; f.write('evidence.json', evidence); f.failure('prepare');
  Object.assign(evidence.checks, { legacyApiStopped: true, legacySmtpStopped: true, legacyWorkersStopped: true, singleWriterConfirmed: true });
  evidence.checkpoints.legacyStopReceipt = 'fixture-stop'; f.write('evidence.json', evidence); f.success('prepare');
});

test('unmounted infrastructure secrets are not read by the application runner', t => {
  const f = fixture(t);
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  config.secrets = { backup_only: { file: '/no-access/infrastructure-backup-secret' } };
  config.services.postgres.secrets = [{ source: 'backup_only' }]; f.write('compose.json', config);
  f.success('prepare');
});

test('production rejects an SMTP phase or tenant override', t => {
  for (const change of [{ NERVION_DEPLOYMENT_PHASE: 'live' }, { TENANCY_BOOTSTRAP_TENANT_ID: '22222222-2222-4222-8222-222222222222' }, { TENANT_JOBS_WORKER_ENABLED: 'true' }]) {
    const f = fixture(t); const { config } = productionFixture(f);
    Object.assign(config.services.smtp.environment, change); f.write('compose.json', config); f.failure('prepare');
  }
});

test('mounted application secrets remain protected by the release fingerprint', t => {
  const f = fixture(t); f.write('app-secret', 'fixture-secret');
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  config.secrets = { app_secret: { file: join(f.root, 'app-secret') } };
  config.services.backend.secrets = [{ source: 'app_secret' }]; f.write('compose.json', config);
  f.success('prepare'); f.write('app-secret', 'changed'); f.failure('migrate');
  assert.equal(f.commands().some(c => c.includes('run')), false);
});

test('pins immutable images, gates migrations and deploys only approved application services', t => {
  const f = fixture(t);
  f.success('prepare');
  assert.equal(f.commands().some(c => c.includes('run') || c.includes('up')), false);
  f.success('migrate');
  f.success('deploy');
  const receipt = JSON.parse(readFileSync(join(f.root, 'state', f.manifest.project, 'deployed-head.json')));
  assert.equal(receipt.commit, commit);
  const up = f.commands().find(c => c.includes('up'));
  assert.deepEqual(up.slice(up.indexOf('--wait-timeout') + 2), ['backend', 'frontend']);
  assert.ok(up.includes('--no-deps') && up.includes('--no-build') && up.includes('never'));
  assert.equal(f.commands().some(c => c.includes('down') || c.includes('build') || c.includes('pull') || c.includes('prune')), false);
  assert.equal(f.commands().filter(c => c.includes('run')).length, 1);
});

test('requires migration receipt before touching application containers', t => {
  const f = fixture(t); f.success('prepare'); f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

for (const target of ['manifest.json', 'compose.json', 'production.env']) {
  test(`rejects changed ${target} after prepare`, t => {
    const f = fixture(t); f.success('prepare'); f.success('migrate');
    writeFileSync(join(f.root, target), `${readFileSync(join(f.root, target), 'utf8')}\n`, { mode: 0o600 });
    f.failure('deploy');
    assert.equal(f.commands().some(c => c.includes('up')), false);
  });
}

test('repeat prepare invalidates the old migration receipt', t => {
  const f = fixture(t); f.success('prepare'); f.success('migrate'); f.success('prepare'); f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('rejects a forged or stale migration fingerprint', t => {
  const f = fixture(t); f.success('prepare'); f.success('migrate');
  const file = join(f.root, 'state', f.manifest.project, 'migration-head.json');
  const receipt = JSON.parse(readFileSync(file)); receipt.fingerprint = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(receipt), { mode: 0o600 }); f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('rejects changed frozen Compose configuration', t => {
  const f = fixture(t); f.success('prepare'); f.success('migrate');
  const head = JSON.parse(readFileSync(join(f.root, 'state', f.manifest.project, 'prepared-head.json')));
  writeFileSync(join(head.release, 'compose.json'), '{}', { mode: 0o600 }); f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('rejects a changed mounted migration script', t => {
  const f = fixture(t); f.write('tenant-migrate.mjs', '// trusted fixture\n');
  const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  config.services.migrate.volumes = [{ type: 'bind', source: join(f.root, 'tenant-migrate.mjs'), target: '/opt/nervion/tenant-migrate.mjs', read_only: true }];
  f.write('compose.json', config); f.success('prepare');
  f.write('tenant-migrate.mjs', '// changed fixture\n'); f.failure('migrate');
  assert.equal(f.commands().some(c => c.includes('run')), false);
});

test('project flock rejects overlapping operations', t => {
  const f = fixture(t); f.success('prepare'); const before = f.commands().length;
  const result = spawnSync('flock', ['-n', join(f.root, 'state', f.manifest.project, 'release.lock'), 'bash', runner, 'migrate',
    '--manifest', join(f.root, 'manifest.json'), '--state-dir', join(f.root, 'state'), '--project', f.manifest.project, '--expected-commit', commit],
  { encoding: 'utf8', env: { ...process.env, HOME: f.root, PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }, timeout: 5000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Another release is running/);
  assert.equal(f.commands().length, before);
});

test('rejects a mutable image before Docker operations', t => {
  const f = fixture(t); f.manifest.images.backend = 'example/backend:latest'; f.write('manifest.json', f.manifest);
  f.failure('prepare'); assert.equal(f.commands().length, 0);
});

test('rejects wrong OCI revision', t => {
  const f = fixture(t, { wrongRevision: true }); f.failure('prepare');
  assert.equal(f.commands().some(c => c.includes('run') || c.includes('up')), false);
});

test('rejects unapproved service even when present in Compose', t => {
  const f = fixture(t); f.manifest.services.push('postgres'); f.write('manifest.json', f.manifest);
  f.failure('prepare'); assert.equal(f.commands().length, 0);
});

test('rejects missing Docker healthcheck', t => {
  const f = fixture(t); const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  delete config.services.frontend.healthcheck; f.write('compose.json', config); f.failure('prepare');
});

test('rejects a legacy or unmarked migration job', t => {
  const f = fixture(t); const config = JSON.parse(readFileSync(join(f.root, 'compose.json')));
  delete config.services.migrate.labels; f.write('compose.json', config); f.failure('prepare');
});

test('migration failure never produces a receipt or starts application updates', t => {
  const f = fixture(t, { migrationFailure: true }); f.success('prepare'); f.failure('migrate'); f.failure('deploy');
  assert.equal(f.commands().some(c => c.includes('up')), false);
});

test('an already active migration blocks another migration', t => {
  const f = fixture(t, { activeMigration: true }); f.success('prepare'); f.failure('migrate');
  assert.equal(f.commands().some(c => c.includes('run')), false);
});

for (const option of ['upFailure', 'healthFailure', 'wrongContainerImage']) {
  test(`${option} fails deployment without automatic rollback`, t => {
    const f = fixture(t, { [option]: true }); f.success('prepare'); f.success('migrate'); f.failure('deploy');
    assert.throws(() => readFileSync(join(f.root, 'state', f.manifest.project, 'deployed-head.json')));
    assert.equal(f.commands().filter(c => c.includes('up')).length, 1);
    assert.equal(f.commands().some(c => c.includes('down')), false);
  });
}

test('private file permissions are enforced', t => {
  const f = fixture(t); chmodSync(join(f.root, 'manifest.json'), 0o644); f.failure('prepare');
  assert.equal(f.commands().length, 0);
});

test('hook distinguishes accepted Git ref from failed deployment', t => {
  const f = fixture(t);
  f.write('hook-runner.sh', '#!/usr/bin/env bash\n[[ "$1" != migrate ]]\n');
  f.write('hook.json', { schemaVersion: 1, branch: 'master', project: f.manifest.project, runner: join(f.root, 'hook-runner.sh'), manifestDirectory: f.root, stateDirectory: join(f.root, 'state') });
  f.write('post-receive', readFileSync(join(directory, 'post-receive'), 'utf8').replace('config=/etc/nervion-release/hook.json', `config=${join(f.root, 'hook.json')}`));
  f.write('refs.txt', `${'0'.repeat(40)} ${commit} refs/heads/master\n`);
  const input = openSync(join(f.root, 'refs.txt'), 'r');
  let result;
  try {
    result = spawnSync('bash', [join(f.root, 'post-receive')], { encoding: 'utf8', stdio: [input, 'pipe', 'pipe'], timeout: 5000, killSignal: 'SIGKILL' });
  } finally {
    closeSync(input);
  }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepted by Git, but deployment failed at migrate/);
  assert.doesNotMatch(result.stdout, /deployed and passed/);
});
