// Explicit isolated integration test. S3 requires a private verification-only
// configuration; no published ports or existing data volumes are used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.argv.length === 4 || process.argv.length === 6,
  'Usage: node fixture.mjs --image sha256:IMAGE_ID [--s3-fixture-config /private/config]');
assert.equal(process.argv[2], '--image');
const image = process.argv[3];
assert.match(image, /^sha256:[0-9a-f]{64}$/);
const here = dirname(fileURLToPath(import.meta.url));
let s3Config;
let s3Prefix;
if (process.argv.length === 6) {
  assert.equal(process.argv[4], '--s3-fixture-config');
  const file = process.argv[5];
  assert.equal(realpathSync(file), file, 'S3 fixture config must have a canonical absolute path');
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 65536,
    'S3 fixture config must be a small private regular file');
  assert.ok(stat.uid === 0 || stat.uid === process.getuid(), 'S3 fixture config has an unexpected owner');
  s3Config = readFileSync(file, 'utf8');
  function parseConfig(text) {
    const values = new Map();
    let section = '';
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      if (line.startsWith('[')) {
        assert.ok(line === '[global]' || line === '[nervion]', 'Unsupported S3 fixture section');
        section = line; continue;
      }
      const equal = line.indexOf('=');
      assert.ok(section && equal > 0, 'Invalid S3 fixture configuration');
      const key = `${section}:${line.slice(0, equal).trim()}`;
      assert.equal(values.has(key), false, 'Duplicate S3 fixture option');
      values.set(key, line.slice(equal + 1).trim());
    }
    return values;
  }
  const sample = parseConfig(readFileSync(join(here, 'pgbackrest.conf.example'), 'utf8'));
  const actual = parseConfig(s3Config);
  assert.deepEqual([...actual.keys()].sort(), [...sample.keys()].sort(), 'Unexpected S3 fixture options');
  const variable = new Set(['repo1-path', 'repo1-s3-bucket', 'repo1-s3-endpoint', 'repo1-s3-region',
    'repo1-s3-key', 'repo1-s3-key-secret', 'repo1-cipher-pass'].map(key => `[global]:${key}`));
  for (const [key, expected] of sample) {
    const value = actual.get(key);
    assert.ok(value && !value.startsWith('REPLACE_'), 'Unconfigured S3 fixture option');
    if (!variable.has(key)) assert.ok(value === expected, `Unsafe S3 fixture option: ${key}`);
  }
  s3Prefix = actual.get('[global]:repo1-path');
  assert.ok(/^\/nervion-backups\/production\/verification\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s3Prefix),
    'S3 fixture must use a unique verification UUID, never the production repository');
  assert.ok(actual.get('[global]:repo1-cipher-pass').length >= 32, 'S3 fixture encryption passphrase is too short');
}
const network = s3Config ? 'bridge' : 'none';
const root = mkdtempSync(join(tmpdir(), 'nervion-backup-fixture-'));
chmodSync(root, 0o700);
const id = `nervion-backup-fixture-${randomBytes(6).toString('hex')}`;
const volumes = {};
const started = [];
const log = [];
const write = (name, content, mode = 0o600) => writeFileSync(join(root, name), content, { mode });
function docker(args, { input, allowFailure = false, timeout = 180000 } = {}) {
  const result = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    input, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C' },
  });
  log.push({ command: args[0], status: result.status, stdout: result.stdout, stderr: result.stderr });
  if (result.error) throw result.error;
  if (!allowFailure) assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`);
  return result;
}
function mount(volume, target, readonly = false) {
  return ['--mount', `type=volume,src=${volume},dst=${target}${readonly ? ',readonly' : ''}`];
}
function bind(source, target) { return ['--mount', `type=bind,src=${source},dst=${target},readonly`]; }
function runtime(role) { return ['--tmpfs', `/var/run/pgbackrest/${role}:uid=999,gid=999,mode=0700`]; }
function helper(args, options) {
  return docker(['run', '--rm', '--network', network, '--read-only', '--label', `io.nervion.fixture=${id}`,
    '--tmpfs', '/tmp:mode=1777', ...args], options);
}
function sql(container, statement, database = 'nervion_data_1') {
  return docker(['exec', '--user', 'postgres', container, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
    '--dbname', database, '--command', statement]).stdout.trim();
}
function waitReady(container) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = docker(['exec', '--user', 'postgres', container, 'psql', '-XAt', '--dbname', 'nervion_data_1',
      '--command', "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='uuid-ossp')"], { allowFailure: true });
    if (result.status === 0 && result.stdout.trim() === 't') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('Isolated database did not become ready');
}
function backrest(command, { data = 'primary', readonly = true, config = 'pgbackrest_config', extra = [], allowFailure = false } = {}) {
  return helper(['--user', 'postgres', ...runtime('backup'),
    ...mount(volumes[data], '/var/lib/postgresql/data', readonly),
    ...mount(volumes.repo, '/var/lib/pgbackrest/repository', data !== 'primary'),
    ...mount(volumes.socket, '/var/run/postgresql', true), ...mount(volumes.secrets, '/run/secrets', true),
    '--entrypoint', 'pgbackrest', image, `--config=/run/secrets/${config}`,
    '--config-include-path=/etc/pgbackrest/empty', '--stanza=nervion',
    ...(['stanza-create', 'backup', 'info', 'restore'].includes(command.at(-1)) ? ['--lock-path=/var/run/pgbackrest/backup/lock'] : []),
    ...extra, ...command], { allowFailure });
}

const secret = randomBytes(48).toString('base64');
const localConfig = `[global]
repo1-type=posix
repo1-path=/var/lib/pgbackrest/repository
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${secret}
repo1-retention-full-type=time
repo1-retention-full=35
archive-async=n
archive-timeout=120
start-fast=y
process-max=2
compress-type=zst
log-level-file=off
[nervion]
pg1-path=/var/lib/postgresql/data/pgdata
pg1-socket-path=/var/run/postgresql
pg1-user=postgres
pg1-port=5432
pg1-database=postgres
`;

try {
  console.log(`${s3Config ? 'Explicit S3 verification' : 'Local-only'} fixture: ${id}; private artifacts: ${root}`);
  for (const name of ['primary', 'restore', 'repo', 'socket', 'restore-socket', 'secrets']) {
    const volume = `${id}-${name}`;
    assert.notEqual(docker(['volume', 'inspect', volume], { allowFailure: true }).status, 0);
    docker(['volume', 'create', '--label', `io.nervion.fixture=${id}`, volume]);
    volumes[name] = volume;
  }
  write('pgbackrest_config', s3Config || localConfig);
  write('wrong_pgbackrest_config', (s3Config || localConfig)
    .replace(/^repo1-cipher-pass=.*$/m, 'repo1-cipher-pass=wrong-fixture-passphrase-with-at-least-32-characters'));
  for (const name of ['postgres_password', 'data_password', 'platform_password', 'data_migrator_password', 'platform_migrator_password']) {
    write(name, randomBytes(32).toString('base64'));
  }
  const init = join(root, 'init');
  mkdirSync(init, { mode: 0o755 });
  copyFileSync(resolve(here, '../../saas/postgres/001-bootstrap.sh'), join(init, '001-bootstrap.sh'));
  chmodSync(join(init, '001-bootstrap.sh'), 0o755);
  copyFileSync(join(here, 'extensions.sql'), join(init, '002-extensions.sql'));
  chmodSync(join(init, '002-extensions.sql'), 0o644);
  helper([...mount(volumes.secrets, '/secrets'), ...mount(volumes.repo, '/repo'),
    ...mount(volumes.restore, '/restore'), ...bind(root, '/fixture'), '--entrypoint', 'bash', image, '-ceu',
    'install -d -o postgres -g postgres -m 0700 /repo /restore/pgdata; for file in pgbackrest_config wrong_pgbackrest_config postgres_password data_password platform_password data_migrator_password platform_migrator_password; do install -o postgres -g postgres -m 0600 "/fixture/$file" "/secrets/$file"; done']);

  const primary = `${id}-primary`;
  const archive = 'pgbackrest --config=/run/secrets/pgbackrest_config --config-include-path=/etc/pgbackrest/empty --stanza=nervion --lock-path=/var/run/pgbackrest/archive/lock archive-push "%p"';
  docker(['run', '--detach', '--name', primary, '--network', network, '--read-only', '--label', `io.nervion.fixture=${id}`,
    '--tmpfs', '/tmp:mode=1777', ...runtime('archive'), ...mount(volumes.primary, '/var/lib/postgresql/data'),
    ...mount(volumes.repo, '/var/lib/pgbackrest/repository'), ...mount(volumes.socket, '/var/run/postgresql'),
    ...mount(volumes.secrets, '/run/secrets', true), ...bind(init, '/docker-entrypoint-initdb.d'),
    ...bind(resolve(here, '../../saas/postgres/bootstrap.sql'), '/opt/nervion/bootstrap.sql'),
    '--env', 'POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password',
    '--env', 'POSTGRES_INITDB_ARGS=--data-checksums --auth-local=trust --auth-host=scram-sha-256',
    image, 'postgres', '-c', 'listen_addresses=', '-c', 'shared_preload_libraries=pg_stat_statements',
    '-c', 'wal_level=replica', '-c', 'archive_mode=on', '-c', 'archive_timeout=60s', '-c', `archive_command=${archive}`]);
  started.push(primary);
  waitReady(primary);
  assert.equal(sql(primary, "SELECT has_schema_privilege('nervion_data','monitoring','USAGE')"), 'f');
  assert.equal(sql(primary, "SELECT has_schema_privilege('nervion_platform','monitoring','USAGE')", 'nervion_platform'), 'f');
  assert.equal(sql(primary, 'SHOW data_checksums'), 'on');
  sql(primary, "CREATE TABLE fixture_events(id integer PRIMARY KEY, message text); INSERT INTO fixture_events VALUES (1,'from full backup')");
  sql(primary, "CREATE TABLE fixture_platform(id integer PRIMARY KEY); INSERT INTO fixture_platform VALUES(1)", 'nervion_platform');
  if (s3Config) {
    const contents = JSON.parse(backrest(['--log-level-console=off', '--output=json', 'repo-ls']).stdout);
    // repo-ls reports the repository root even when it contains no objects.
    assert.deepEqual(contents, { '.': { type: 'path' } },
      'S3 fixture prefix is not empty; refusing to reuse it');
  }
  backrest(['stanza-create']);
  backrest(['check']);
  backrest(['--type=full', 'backup']);
  console.log('Encrypted full backup passed with shared data mounted read-only.');
  sql(primary, "INSERT INTO fixture_events VALUES(2,'from differential backup')");
  backrest(['--type=diff', 'backup']);
  sql(primary, "INSERT INTO fixture_events VALUES(3,'from archived WAL')");
  const target = sql(primary, 'SELECT clock_timestamp()');
  sql(primary, "SELECT pg_sleep(0.05); DELETE FROM fixture_events; INSERT INTO fixture_events VALUES(4,'after recovery target')");
  assert.equal(sql(primary, 'SELECT string_agg(id::text,\',\' ORDER BY id) FROM fixture_events'), '4');
  backrest(['check']);
  const archiver = JSON.parse(sql(primary, readFileSync(join(here, 'monitor.sql'), 'utf8'), 'postgres'));
  assert.equal(typeof archiver.pendingWalFiles, 'number');
  assert.equal(archiver.unresolvedArchiveFailure, false);
  const info = JSON.parse(backrest(['--log-level-console=off', '--output=json', 'info']).stdout);
  assert.equal(info[0].cipher, 'aes-256-cbc');
  assert.equal(info[0].status.code, 0);
  assert.deepEqual(info[0].backup.map(backup => backup.type), ['full', 'diff']);
  if (s3Config) {
    const rawInfo = backrest(['--log-level-console=off', '--raw', 'repo-get', 'backup/nervion/backup.info']).stdout;
    assert.ok(rawInfo.startsWith('Salted__'), 'S3 object must contain pgBackRest ciphertext');
  } else {
    const encryptedHeader = helper([...mount(volumes.repo, '/repo', true), '--entrypoint', 'od', image,
      '-An', '-tx1', '-N8', '/repo/backup/nervion/backup.info']).stdout.replace(/\s/g, '');
    assert.equal(encryptedHeader, '53616c7465645f5f', 'pgBackRest repository metadata must be encrypted');
  }
  const wrongCipher = backrest(['--pg1-path=/tmp/wrong-key-restore', 'restore'],
    { data: 'restore', readonly: false, config: 'wrong_pgbackrest_config', allowFailure: true });
  assert.notEqual(wrongCipher.status, 0, 'restore must reject the wrong key');
  const wrongCipherMessage = wrongCipher.stdout + wrongCipher.stderr;
  // A wrong CBC key can be reported as invalid decoded metadata before the
  // final cipher block is checked. Require that failure, not any nonzero exit.
  assert.ok(wrongCipher.status === 75 && /unable to load info file/i.test(wrongCipherMessage) &&
    /CryptoError|FormatError|decrypt/i.test(wrongCipherMessage),
  'wrong-key rejection must fail decoding backup metadata, not CLI or connection validation');
  backrest(['--type=time', `--target=${target}`, '--target-action=promote', '--archive-mode=off', 'restore'], { data: 'restore', readonly: false });

  const restored = `${id}-restored`;
  docker(['run', '--detach', '--name', restored, '--network', network, '--read-only', '--label', `io.nervion.fixture=${id}`,
    '--tmpfs', '/tmp:mode=1777', ...runtime('backup'), ...mount(volumes.restore, '/var/lib/postgresql/data'),
    ...mount(volumes.repo, '/var/lib/pgbackrest/repository', true), ...mount(volumes['restore-socket'], '/var/run/postgresql'),
    ...mount(volumes.secrets, '/run/secrets', true), image, 'postgres', '-c', 'listen_addresses=',
    '-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'archive_mode=off']);
  started.push(restored);
  waitReady(restored);
  for (let attempt = 0; attempt < 30 && sql(restored, 'SELECT pg_is_in_recovery()') === 't'; attempt++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.equal(sql(restored, 'SELECT pg_is_in_recovery()'), 'f');
  assert.equal(sql(restored, 'SELECT string_agg(id::text,\',\' ORDER BY id) FROM fixture_events'), '1,2,3');
  assert.equal(sql(restored, 'SELECT count(*) FROM fixture_platform', 'nervion_platform'), '1');
  console.log('PITR passed: full + differential + WAL restored both databases; later deletion excluded.');

  // Policy wrappers are tested with a fake pgBackRest executable. Even an
  // accidental policy regression cannot contact the fixture S3 hostname.
  const policy = readFileSync(join(here, 'pgbackrest.conf.example'), 'utf8')
    .replaceAll('REPLACE_PRIVATE_BUCKET', 'fixture-bucket').replaceAll('REPLACE_S3_HOSTNAME', 's3.invalid')
    .replaceAll('REPLACE_REGION', 'fixture').replaceAll('REPLACE_ACCESS_KEY', 'fixture-access-key')
    .replaceAll('REPLACE_SECRET_ACCESS_KEY', 'fixture-secret-key')
    .replaceAll('REPLACE_WITH_SEPARATELY_STORED_RANDOM_PASSPHRASE', 'fixture-only-passphrase-with-at-least-32-characters');
  write('fake-pgbackrest', '#!/bin/sh\ntest -z "${PGBACKREST_REPO1_CIPHER_TYPE+x}" || exit 91\ntest -z "${PGBACKREST_REPO1_PATH+x}" || exit 92\nprintf "%s\\n" "$@"\n', 0o755);
  write('failed-pgbackrest', '#!/bin/sh\nexit 23\n', 0o755);
  const walName = '000000010000000000000001';
  const cases = [
    { name: 'valid', config: policy, args: ['nervion-backup', 'info'], status: 0 },
    { name: 'unencrypted', config: policy.replace('aes-256-cbc', 'none') },
    { name: 'missing-passphrase', config: policy.replace(/^repo1-cipher-pass=.*$/m, '') },
    { name: 'other-prefix', config: policy.replace('/nervion-backups/production', '/other') },
    { name: 'retention-too-short', config: policy.replace('repo1-retention-full=35', 'repo1-retention-full=7') },
    { name: 'insecure-tls', config: policy.replace('repo1-storage-verify-tls=y', 'repo1-storage-verify-tls=n') },
    { name: 'extra-repository', config: policy.replace('[global]', '[global]\nrepo2-type=s3') },
    { name: 'drop-wal-limit', config: policy.replace('[global]', '[global]\narchive-push-queue-max=1GiB') },
    { name: 'command-override', config: policy + '\n[global:archive-push]\nrepo1-cipher-type=none\n' },
    { name: 'duplicate-option', config: policy.replace('archive-async=n', 'archive-async=n\narchive-async=y') },
    { name: 'wrong-permissions', config: policy, mode: '0644' },
    { name: 'wal-traversal', config: policy, args: ['nervion-archive-push', `pg_wal/../${walName}`] },
    { name: 'wal-outside', config: policy, args: ['nervion-archive-push', `/tmp/${walName}`] },
    { name: 'wal-symlink', config: policy, args: ['nervion-archive-push', `pg_wal/${walName}`], symlink: true },
    { name: 'valid-wal-failure-propagates', config: policy, args: ['nervion-archive-push', `pg_wal/${walName}`], executable: 'failed-pgbackrest', status: 23 },
  ];
  for (const [index, item] of cases.entries()) {
    const file = `policy-${index}.conf`; write(file, item.config);
    const setup = `install -o postgres -g postgres -m ${item.mode || '0600'} /fixture/${file} /run/secrets/pgbackrest_config; install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/data/pgdata/pg_wal; ${item.symlink ? `touch /tmp/wal; ln -s /tmp/wal /var/lib/postgresql/data/pgdata/pg_wal/${walName}` : `touch /var/lib/postgresql/data/pgdata/pg_wal/${walName}`}; exec gosu postgres env PGBACKREST_REPO1_CIPHER_TYPE=none PGBACKREST_REPO1_PATH=/other "$@"`;
    const result = helper(['--tmpfs', '/run/secrets:uid=999,gid=999,mode=0700', '--tmpfs', '/var/lib/postgresql/data:uid=999,gid=999,mode=0700',
      ...runtime('archive'), ...runtime('backup'), ...bind(root, '/fixture'),
      ...bind(join(root, item.executable || 'fake-pgbackrest'), '/usr/bin/pgbackrest'),
      '--entrypoint', 'bash', image, '-ceu', setup, '--', ...(item.args || ['nervion-backup', 'info'])], { allowFailure: true });
    assert.equal(result.status, item.status ?? 1, item.name + ': ' + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret-key|fixture-only-passphrase/);
  }
  console.log(`Production policy checks passed: ${cases.length}; environment overrides cleared; archive failure propagated.`);
  write('result.json', JSON.stringify({ id, image, volumes, target, encryptedBackupTypes: ['full', 'diff'],
    pitrRestoredIds: [1, 2, 3], wrongKeyRejected: true, policyCases: cases.length, network,
    repository: s3Config ? { type: 's3', prefix: s3Prefix } : { type: 'posix' },
    primaryDataReadOnlyInBackupJob: true, repositoryReadOnlyMountDuringRestore: !s3Config, status: 'passed' }, null, 2) + '\n');
} finally {
  for (const container of started.reverse()) {
    const inspect = docker(['container', 'inspect', container, '--format', '{{index .Config.Labels "io.nervion.fixture"}}'], { allowFailure: true });
    if (inspect.status === 0 && inspect.stdout.trim() === id) {
      const output = docker(['logs', container], { allowFailure: true });
      write(`${container}.log`, output.stdout + output.stderr);
      docker(['stop', '--time', '30', container], { allowFailure: true });
    }
  }
  write('commands.json', JSON.stringify(log, null, 2) + '\n');
  write('resources.json', JSON.stringify({ id, image, volumes, containers: started }, null, 2) + '\n');
  console.log(`Own containers stopped; fresh fixture volumes and logs retained in ${root}`);
}
