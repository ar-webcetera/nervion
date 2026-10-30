import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const evaluate = (source, globals = {}, imports = {}) => {
  const compiled = ts.transpileModule(source.replaceAll('import.meta.server', 'false'), {
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
const load = (relative, globals, imports) => evaluate(readFileSync(new URL(relative, import.meta.url), 'utf8'), globals, imports);
const { ROLES } = load('../types/user.ts');
const features = load('../utils/tenantFeatures.ts', {}, { '~/types/user': { ROLES } });
const coreFeatures = ['tasks', 'projects', 'files', 'chat', 'wiki', 'crm', 'reports'];
const optInFeatures = ['mail', 'git', 'voice', 'healthchecks'];
const disabledFlags = Object.fromEntries([...coreFeatures, ...optInFeatures].map((feature) => [feature, false]));

const makeStore = (flags, enabled = true) => {
  const { useTenantStore } = load('../stores/tenantStore.ts', {
    useTenantFetch: () => async () => ({ featureFlags: flags, readOnly: false }),
    useRuntimeConfig: () => ({ public: { tenancyEnabled: enabled } }),
    ref: (value) => ({ value }),
    computed: (get) => ({ get value() { return get(); } }),
  }, {
    pinia: { defineStore: (_id, setup) => setup },
    '~/utils/tenantFeatures': features,
  });
  const store = useTenantStore();
  return new Proxy(store, {
    get: (target, key) => {
      const value = target[key];
      return value && typeof value === 'object' && 'value' in value ? value.value : value;
    },
    set: (target, key, value) => {
      const current = target[key];
      if (current && typeof current === 'object' && 'value' in current) current.value = value;
      else target[key] = value;
      return true;
    },
  });
};

const makeGuard = (flags, role = ROLES.admin, authenticated = true) => {
  const tenantStore = makeStore(flags);
  const userStore = { user: null };
  const { default: guard } = load('../middleware/auth.ts', {
    defineNuxtRouteMiddleware: (middleware) => middleware,
    useTenantStore: () => tenantStore,
    useApiBaseUrl: () => '',
    useState: (_key, initial) => ({ value: initial() }),
    $fetch: async () => {
      if (!authenticated) throw new Error('Unauthorized');
      return { id: 1, role };
    },
    navigateTo: (path, options) => ({ path, replace: options?.replace }),
    createError: ({ statusCode, statusMessage }) => Object.assign(new Error(statusMessage), { statusCode }),
  }, { '~/stores/userStore': { useUserStore: () => userStore } });
  return { guard, tenantStore, userStore };
};

test('missing core flags stay enabled and missing opt-in flags stay disabled', () => {
  for (const flags of [undefined, {}, { mail: false, git: false, voice: false, healthchecks: false }]) {
    for (const feature of coreFeatures) assert.equal(features.isTenantFeatureEnabled(flags, feature), true, feature);
    for (const feature of optInFeatures) assert.equal(features.isTenantFeatureEnabled(flags, feature), false, feature);
  }
  for (const feature of [...coreFeatures, ...optInFeatures]) {
    assert.equal(features.isTenantFeatureEnabled({ [feature]: false }, feature), false);
    assert.equal(features.isTenantFeatureEnabled({ [feature]: true }, feature), true);
  }
});

test('tenant store uses task access for home, planning and calendar menus and routes', async () => {
  const store = makeStore({ tasks: false });
  await store.load();
  for (const key of ['home', 'planning', 'calendar']) assert.equal(store.menuAllowed(key), false, key);
  for (const path of ['/', '/planning', '/calendar', '/calendar/detail']) assert.equal(store.routeAllowed(path), false, path);
  assert.equal(store.menuAllowed('projects'), true);
  assert.equal(store.routeAllowed('/projects'), true);
  assert.equal(store.routeAllowed('/403'), true);
});

test('legacy mode ignores tenant flags and keeps the existing home landing', async () => {
  const store = makeStore(disabledFlags, false);
  await store.load();
  assert.equal(store.tenant, null);
  for (const feature of [...coreFeatures, ...optInFeatures]) assert.equal(store.canUse(feature), true, feature);
  assert.equal(store.getLandingPath(ROLES.admin), '/');
  assert.equal(store.routeAllowed('/calendar'), true);
});

test('landing chooses a permitted module and respects the user role', () => {
  const landing = (flags, role) => features.getTenantLandingPath((feature) => features.isTenantFeatureEnabled(flags, feature), role);
  assert.equal(landing({}, ROLES.admin), '/');
  assert.equal(landing({ tasks: false }, ROLES.guest), '/projects');
  assert.equal(landing({ ...disabledFlags, chat: true }, ROLES.guest), '/chat');
  assert.equal(landing({ ...disabledFlags, wiki: true }, ROLES.employee), '/wiki');
  assert.equal(landing({ ...disabledFlags, wiki: true }, ROLES.guest), '/403');
  assert.equal(landing({ ...disabledFlags, crm: true }, ROLES.admin), '/crm/deals');
  assert.equal(landing({ ...disabledFlags, crm: true }, ROLES.employee), '/403');
  assert.equal(landing(disabledFlags, ROLES.admin), '/403');
});

test('authenticated login and the disabled task homepage redirect to an allowed landing', async () => {
  for (const route of [{ name: 'login', path: '/login' }, { name: 'home', path: '/' }]) {
    const { guard } = makeGuard({ ...disabledFlags, wiki: true }, ROLES.employee);
    const result = await guard(route);
    assert.equal(result.path, '/wiki');
    assert.equal(result.replace, true);
  }
});

test('disabled feature routes fail with 403 without logging the user out', async () => {
  for (const path of ['/calendar', '/planning', '/projects', '/chat', '/mail-accounts']) {
    const { guard, userStore } = makeGuard(disabledFlags);
    await assert.rejects(guard({ name: path.slice(1), path }), { statusCode: 403 });
    assert.equal(userStore.user.role, ROLES.admin);
  }
});

test('all modules disabled use a stable fallback and retain the user profile', async () => {
  const { guard, userStore } = makeGuard(disabledFlags, ROLES.guest);
  const result = await guard({ name: 'home', path: '/' });
  assert.equal(result.path, '/403');
  assert.equal(await guard({ name: '403', path: '/403' }), undefined);
  assert.equal(userStore.user.role, ROLES.guest);
});

test('unauthenticated requests still redirect to login without a redirect loop', async () => {
  const { guard } = makeGuard(disabledFlags, ROLES.guest, false);
  assert.equal((await guard({ name: 'home', path: '/' })).path, '/login');
  assert.equal(await guard({ name: 'login', path: '/login' }), undefined);
});

test('platform edit form displays effective defaults while retaining explicit false flags', () => {
  const sfc = readFileSync(new URL('../pages/platform/index.vue', import.meta.url), 'utf8');
  const script = sfc.slice(sfc.indexOf('>', sfc.indexOf('<script')) + 1, sfc.indexOf('</script>'));
  const sourceFile = ts.createSourceFile('platform.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const selected = new Set(['features', 'emptyForm', 'openForm']);
  const declarations = sourceFile.statements.filter((statement) =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && selected.has(declaration.name.text),
    ),
  );
  assert.equal(declarations.length, selected.size);
  const form = {};
  const { openForm } = evaluate(`${declarations.map((statement) => statement.getText(sourceFile)).join('\n')}\nexport { openForm };`, {
    TenantStatus: { ACTIVE: 'active' },
    form,
    editingId: { value: null },
    formOpen: { value: false },
    confirmingStatus: { value: false },
    formError: { value: '' },
    feedback: { value: '' },
  });
  openForm({ featureFlags: { mail: false, git: false, voice: false, healthchecks: false, projects: false } });
  for (const feature of coreFeatures) assert.equal(form.featureFlags[feature], feature !== 'projects', feature);
  for (const feature of optInFeatures) assert.equal(form.featureFlags[feature], false, feature);
  openForm({ featureFlags: { mail: true } });
  assert.equal(form.featureFlags.mail, true);
  assert.equal(form.featureFlags.projects, true);
});
