import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const fakeDocker = `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const root=process.env.HOME;const options=JSON.parse(fs.readFileSync(path.join(root,'options.json')));
const args=process.argv.slice(2);fs.appendFileSync(path.join(root,'commands.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]!=='--host'||args[1]!=='unix:///var/run/docker.sock')process.exit(91);
if(args.includes('config')){
 console.log(JSON.stringify({services:{backup:{image:options.mutableImage?'example:latest':'sha256:'+'a'.repeat(64),user:'postgres',entrypoint:['/usr/local/bin/nervion-backup']}}}));process.exit(0);
}
if(!args.includes('run')||!args.includes('--no-deps')||!args.includes('never'))process.exit(92);
const operation=args.at(-1);if(args.at(-2)!=='backup')process.exit(93);
if(operation==='info'){
 const now=Math.floor(Date.now()/1000);
 const backups=options.noBackups?[]:[{type:'full',timestamp:{stop:now-(options.fullAge||86400)}},{type:'diff',timestamp:{stop:now-(options.latestAge||3600)}}];
 console.log(JSON.stringify([{name:'nervion',cipher:options.unencrypted?'none':'aes-256-cbc',status:{code:options.infoFailure?5:options.noBackups?2:0},backup:backups}]));process.exit(0);
}
if(!['full','diff'].includes(operation))process.exit(94);
process.exit(options.backupFailure?23:0);
`;
const fakeDate = `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const options=JSON.parse(fs.readFileSync(path.join(process.env.HOME,'options.json')));
const format=process.argv.at(-1);if(format==='+%u')console.log(options.weekday||'1');else if(format==='+%s')console.log(Math.floor(Date.now()/1000));else process.exit(95);
`;
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nervion-backup-job-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, 'docker'), fakeDocker.replace('#!/usr/bin/env node', `#!${process.execPath}`), { mode: 0o700 });
  writeFileSync(join(bin, 'date'), fakeDate.replace('#!/usr/bin/env node', `#!${process.execPath}`), { mode: 0o700 });
  writeFileSync(join(root, 'options.json'), JSON.stringify(options), { mode: 0o600 });
  writeFileSync(join(root, 'compose.yml'), '# fake Docker fixture only\n', { mode: 0o600 });
  writeFileSync(join(root, 'production.env'), '', { mode: 0o600 });
  const runner = readFileSync(join(directory, 'backup-job.sh'), 'utf8')
    .replace('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', `PATH=${bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)
    .replace('/run/lock/nervion-backup-$project.lock', `${root}/job.lock`);
  writeFileSync(join(root, 'runner.sh'), runner, { mode: 0o700 });
  const run = operation => spawnSync('bash', [join(root, 'runner.sh'), operation], { encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, HOME: root, NERVION_BACKUP_PROJECT: 'test-backup', NERVION_BACKUP_DIRECTORY: root,
      NERVION_BACKUP_COMPOSE: join(root, 'compose.yml'), NERVION_BACKUP_ENV_FILE: join(root, 'production.env') } });
  const commands = () => readFileSync(join(root, 'commands.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  return { run, commands };
}

for (const [name, options, expected] of [
  ['Sunday is full', { weekday: '7' }, 'full'],
  ['weekday is differential after a recent full', {}, 'diff'],
  ['missed full is caught up after downtime', { fullAge: 8 * 86400 }, 'full'],
  ['empty stanza starts with a full backup', { noBackups: true }, 'full'],
]) {
  test(name, t => {
    const f = fixture(t, options); const result = f.run('scheduled');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.commands().at(-1).at(-1), expected);
    assert.equal(f.commands().some(args => args.includes('up') || args.includes('build') || args.includes('down')), false);
  });
}
test('failed repository status blocks a scheduled backup', t => {
  const f = fixture(t, { infoFailure: true }); assert.notEqual(f.run('scheduled').status, 0);
  assert.equal(f.commands().some(args => args.at(-1) === 'full' || args.at(-1) === 'diff'), false);
});
test('backup failure propagates to systemd', t => {
  const f = fixture(t, { backupFailure: true }); assert.equal(f.run('full').status, 23);
});
test('immutable image requirement blocks mutable tags', t => {
  const f = fixture(t, { mutableImage: true }); assert.notEqual(f.run('full').status, 0);
  assert.equal(f.commands().some(args => args.includes('run')), false);
});
for (const [name, options, expected] of [
  ['fresh encrypted backup passes monitoring', {}, 0],
  ['stale latest backup fails monitoring', { latestAge: 2 * 86400, fullAge: 3 * 86400 }, 1],
  ['stale full fails monitoring', { fullAge: 9 * 86400 }, 1],
  ['unencrypted repository fails monitoring', { unencrypted: true }, 1],
]) {
  test(name, t => { const f = fixture(t, options); assert.equal(f.run('monitor').status, expected); });
}
test('monitor timeout reaches OnFailure without imposing a full-backup deadline', () => {
  const monitor = readFileSync(join(directory, 'nervion-backup-monitor.service'), 'utf8');
  const backup = readFileSync(join(directory, 'nervion-backup.service'), 'utf8');
  assert.match(monitor, /^TimeoutStartSec=120s$/m);
  assert.match(monitor, /^OnFailure=nervion-ops-alert@%n\.service$/m);
  assert.match(backup, /^TimeoutStartSec=infinity$/m);
});
