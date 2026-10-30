import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (relative, globals = {}, imports = {}) => {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return exports;
};

const enums = load('../../../packages/contracts/src/git/git.enums.ts');
const { GitRepositoryAvailability: Availability, GitRepositoryMode: Mode } = enums;
const helpers = load('../utils/gitRepository.ts', {}, { '@tracker/contracts': enums });
const repository = (id, mode = Mode.MANAGED, available = true) => ({
  id,
  name: `Repository ${id}`,
  projectId: null,
  defaultBranch: 'main',
  cloneUrl: null,
  mode,
  availability: available ? Availability.AVAILABLE : Availability.UNAVAILABLE,
  capabilities: {
    canRead: available,
    canFetch: available && mode === Mode.MANAGED,
    canDelete: available && mode !== Mode.EXTERNAL_READ_ONLY,
  },
});
const branches = [{ name: 'main', sha: 'head', lastCommitDate: '', isDefault: true }];
const file = (path) => ({ path, ref: 'main', size: 1, binary: false, truncated: false, content: path });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const setup = ({ readOnly = false, respond = async (url) => (url.endsWith('/branches') ? branches : []) } = {}) => {
  const requests = [];
  const tenant = { readOnly };
  const { useGitStore } = load(
    '../stores/gitStore.ts',
    {
      ref: (value) => ({ value }),
      computed: (get) => ({
        get value() {
          return get();
        },
      }),
      useTenantFetch: () => async (url, options) => {
        requests.push({ url, options });
        return respond(url, options);
      },
      useApiBaseUrl: () => '',
      useApiRequestHeaders: () => ({}),
    },
    {
      pinia: { defineStore: (_id, factory) => factory },
      '~/utils/gitRepository': helpers,
      '~/stores/tenantStore': { useTenantStore: () => tenant },
    },
  );
  return { store: useGitStore(), requests, tenant };
};

test('unavailable repositories remain selected without content or background requests', async () => {
  const { store, requests } = setup();
  store.repos.value = [repository(1), repository(2, Mode.EXTERNAL_READ_ONLY, false)];
  store.commits.value = [{ hash: 'old' }];
  store.tree.value = [{ path: 'old.txt' }];
  store.detail.value = { kind: 'file', data: file('old.txt') };
  await store.selectRepo(2);
  await store.loadDetail('old');
  assert.equal(store.currentRepoId.value, 2);
  assert.equal(store.selectedRepo.value.name, 'Repository 2');
  assert.equal(store.currentBranch.value, '');
  for (const key of ['branches', 'commits', 'tree']) assert.equal(store[key].value.length, 0, key);
  assert.equal(store.detail.value, null);
  assert.equal(store.detailLoading.value, false);
  assert.equal(requests.length, 0);
});

test('read requests reject unknown, unavailable, and capability-denied repositories', () => {
  const { store, requests } = setup();
  const denied = repository(3);
  denied.capabilities.canRead = false;
  store.repos.value = [repository(2, Mode.EXTERNAL_READ_ONLY, false), denied];
  for (const id of [1, 2, 3]) {
    for (const read of [
      () => store.fetchBranches(id),
      () => store.fetchCommits(id, 'main'),
      () => store.fetchTree(id, 'main'),
      () => store.fetchFile(id, 'main', 'README.md'),
      () => store.fetchCommitDiff(id, 'head'),
      () => store.fetchRangeDiff(id, 'old', 'head'),
    ])
      assert.throws(read, /Репозиторий недоступен/);
  }
  assert.equal(requests.length, 0);
});

test('repository and tenant capabilities prevent external mutations before HTTP', async () => {
  const { store, requests, tenant } = setup();
  store.repos.value = [repository(1, Mode.EXTERNAL_READ_ONLY), repository(2), repository(3, Mode.SELF_HOSTED)];
  await assert.rejects(store.syncRepo(1), /недоступно/);
  await assert.rejects(store.deleteRepo(1), /недоступно/);
  await assert.rejects(store.syncRepo(3), /недоступно/);
  await assert.rejects(store.syncRepo(99), /недоступно/);
  await assert.rejects(store.deleteRepo(99), /недоступно/);
  assert.equal(requests.length, 0);
  tenant.readOnly = true;
  await assert.rejects(store.syncRepo(2), /недоступно/);
  await assert.rejects(store.deleteRepo(2), /недоступно/);
  assert.equal(requests.length, 0);
  tenant.readOnly = false;
  await store.syncRepo(2);
  await store.deleteRepo(2);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[1].options.method, 'DELETE');
});

test('SSR response cannot expose stale content for an unavailable repository', async () => {
  const missing = repository(2, Mode.EXTERNAL_READ_ONLY, false);
  const { store, requests } = setup({
    respond: async () => ({
      repos: [missing],
      repoId: missing.id,
      branch: 'main',
      branches,
      commits: [{ hash: 'old' }],
      tree: [{ path: 'old.txt' }],
      detail: { kind: 'file', data: file('old.txt') },
    }),
  });
  await store.loadInitial(2, 'main', undefined, 'old.txt');
  assert.equal(store.currentRepoId.value, 2);
  assert.equal(store.currentBranch.value, '');
  for (const key of ['branches', 'commits', 'tree']) assert.equal(store[key].value.length, 0, key);
  assert.equal(store.detail.value, null);
  assert.equal(requests.length, 1);
});

test('late branches from the previous repository do not start content requests', async () => {
  const pending = deferred();
  const { store, requests } = setup({ respond: () => pending.promise });
  store.repos.value = [repository(1), repository(2, Mode.EXTERNAL_READ_ONLY, false)];
  const first = store.selectRepo(1);
  await store.selectRepo(2);
  pending.resolve(branches);
  await first;
  assert.equal(store.currentRepoId.value, 2);
  assert.equal(store.branches.value.length, 0);
  assert.equal(store.selectionLoading.value, false);
  assert.equal(requests.length, 1);
});

test('late commits and tree from the previous branch cannot repopulate cleared content', async () => {
  const pending = deferred();
  const { store } = setup({ respond: () => pending.promise });
  store.repos.value = [repository(1), repository(2, Mode.EXTERNAL_READ_ONLY, false)];
  store.currentRepoId.value = 1;
  const first = store.selectBranch('main');
  await store.selectRepo(2);
  pending.resolve([{ path: 'stale', hash: 'stale' }]);
  await first;
  assert.equal(store.currentRepoId.value, 2);
  assert.equal(store.commits.value.length, 0);
  assert.equal(store.tree.value.length, 0);
});

test('late detail response cannot appear inside another repository', async () => {
  const pending = deferred();
  const { store } = setup({ respond: () => pending.promise });
  store.repos.value = [repository(1), repository(2, Mode.EXTERNAL_READ_ONLY, false)];
  store.currentRepoId.value = 1;
  store.currentBranch.value = 'main';
  const first = store.loadDetail(undefined, 'old.txt');
  await store.selectRepo(2);
  pending.resolve(file('old.txt'));
  await first;
  assert.equal(store.detail.value, null);
  assert.equal(store.detailLoading.value, false);
});

test('latest detail request wins when files are opened quickly', async () => {
  const pending = new Map([
    ['first.txt', deferred()],
    ['second.txt', deferred()],
  ]);
  const { store } = setup({ respond: (_url, { query }) => pending.get(query.path).promise });
  store.repos.value = [repository(1, Mode.EXTERNAL_READ_ONLY)];
  store.currentRepoId.value = 1;
  store.currentBranch.value = 'main';
  const first = store.loadDetail(undefined, 'first.txt');
  const second = store.loadDetail(undefined, 'second.txt');
  pending.get('second.txt').resolve(file('second.txt'));
  await second;
  pending.get('first.txt').resolve(file('first.txt'));
  await first;
  assert.equal(store.detail.value.entry.path, 'second.txt');
  assert.equal(store.detailLoading.value, false);
});
