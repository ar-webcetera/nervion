import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run.sh'), 'utf8');
const functions = ['canonical', 'regular', 'secret_input'].map(name => {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Missing ${name}`);
  return match[0];
}).join('\n');

// Metadata is simulated to exercise root/service UID contracts without requiring
// root on a developer workstation. Path existence and canonicalization are real.
function fixture(t, changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nervion-secret-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'data_password');
  writeFileSync(file, 'PRIVATE-fixture-only', { mode: 0o600 });
  const metadata = { [file]: { u: 10001, g: 0, a: '440', h: 1, ...changes } };
  for (let parent = root; ; parent = dirname(parent)) {
    metadata[parent] = { u: 0, a: parent === root ? '700' : '755' };
    if (parent === '/') break;
  }
  const bin = join(root, 'bin'); mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, 'stat'), `#!/usr/bin/env node
const fs=require('node:fs');
const values=JSON.parse(fs.readFileSync(${JSON.stringify(join(root, 'metadata.json'))},'utf8'));
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='-c'||args[2]!=='--'||!/^%[ugah]$/.test(args[1]))process.exit(91);
const value=values[args[3]]?.[args[1][1]];
if(value===undefined)process.exit(92);
console.log(value);
`, { mode: 0o700 });
  const execute = ({ role = 'data_password', uid = 0, path = file, regular = false } = {}) => {
    writeFileSync(join(root, 'metadata.json'), JSON.stringify(metadata));
    const code = `set -Eeuo pipefail\nfixture_euid=${uid}\nfail(){ printf '%s\\n' "$1" >&2; exit 1; }\n${functions.replaceAll('$EUID', '$fixture_euid')}\n${regular ? 'regular "$1"' : 'secret_input "$1" "$2"'}`;
    const result = spawnSync('bash', ['-c', code, 'secret-fixture', path, role], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-fixture-only/);
    return result;
  };
  return { file, root, metadata, execute };
}

test('only matching database roles allow service ownership with exact private modes', t => {
  for (const [role, owner] of [['data_password', 10001], ['platform_password', 10001], ['data_migrator_password', 999], ['platform_migrator_password', 999]]) {
    for (const mode of ['400', '440']) {
      const f = fixture(t, { u: owner, a: mode });
      const result = f.execute({ role }); assert.equal(result.status, 0, result.stderr);
    }
  }
});

test('normal root or runner-owned files keep their previous ownership contract', t => {
  for (const uid of [0, 1000]) {
    const f = fixture(t, { u: uid, a: '600' });
    assert.equal(f.execute({ uid, role: 'jwt_secret' }).status, 0);
  }
});

test('service ownership never permits ordinary executable or manifest inputs', t => {
  const f = fixture(t);
  assert.notEqual(f.execute({ regular: true }).status, 0);
});

test('root-owned ordinary inputs also reject writable or unprivileged ancestors', t => {
  for (const change of [{ u: 1000 }, { a: '775' }, { a: '1777' }]) {
    const f = fixture(t, { u: 0, a: '600' });
    Object.assign(f.metadata[dirname(f.root)], change);
    assert.notEqual(f.execute({ regular: true }).status, 0);
  }
});

test('service-owned secrets reject unrelated roles, wrong owner and nonroot runners', t => {
  const f = fixture(t);
  for (const request of [{ role: 'jwt_secret' }, { role: 'data_migrator_password' }, { uid: 1000 }]) {
    assert.notEqual(f.execute(request).status, 0);
  }
  f.metadata[f.file].u = 12345;
  assert.notEqual(f.execute().status, 0);
});

test('service-owned secret mode, group and hardlink checks fail closed', t => {
  for (const metadata of [{ g: 10001 }, { h: 2 }, ...['600', '640', '444', '660', '460', '644', '4400'].map(a => ({ a }))]) {
    const f = fixture(t, metadata);
    assert.notEqual(f.execute().status, 0);
  }
});

test('every ancestor must belong to root and reject group/world write even when sticky', t => {
  for (const change of [{ u: 1000 }, { a: '770' }, { a: '777' }, { a: '1777' }]) {
    const f = fixture(t);
    Object.assign(f.metadata[dirname(f.root)], change);
    assert.notEqual(f.execute().status, 0);
  }
});

test('a root-owned private ancestor is mandatory', t => {
  const f = fixture(t); f.metadata[f.root].a = '755';
  assert.notEqual(f.execute().status, 0);
});

test('service-owned source cannot be a symlink or noncanonical path', t => {
  const f = fixture(t); const alias = join(f.root, 'alias'); symlinkSync(f.file, alias);
  assert.notEqual(f.execute({ path: alias }).status, 0);
  assert.notEqual(f.execute({ path: `${f.root}/./data_password` }).status, 0);
});

test('permissions are checked again on every invocation', t => {
  const f = fixture(t); assert.equal(f.execute().status, 0);
  f.metadata[f.file].a = '660'; assert.notEqual(f.execute().status, 0);
});
