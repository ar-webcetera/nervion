import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const compile = (url) =>
  ts.transpileModule(readFileSync(url, 'utf8').replaceAll('import.meta.client', 'true'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const enumExports = {};
runInNewContext(compile(new URL('../enums/push.enums.ts', import.meta.url)), { exports: enumExports });
const { PushStatus } = enumExports;
const source = compile(new URL('../stores/pushStore.ts', import.meta.url));

const setup = ({ disabled, permission = 'granted', failDelete = false, failUnsubscribe = false, failTest = false } = {}) => {
  const storage = new Map(disabled ? [['push-device-disabled', disabled]] : []);
  const requests = [];
  const reports = [];
  let permissionRequests = 0;
  const subscription = {
    endpoint: 'https://push.example/this-device',
    toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }),
    unsubscribe: async () => {
      if (failUnsubscribe) throw new Error('offline');
      return true;
    },
  };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  const notification = {
    permission,
    requestPermission: async () => {
      permissionRequests++;
      return notification.permission;
    },
  };
  const exports = {};
  const context = {
    exports,
    console,
    ref: (value) => ({ value }),
    useRuntimeConfig: () => ({ public: { API_URL: '' } }),
    useApiBaseUrl: () => '',
    useTenantFetch: () => context.$fetch,
    useUserStore: () => ({ user: { id: 7 } }),
    window: { isSecureContext: true, Notification: notification, PushManager: {} },
    Notification: notification,
    navigator: { serviceWorker: { getRegistration: async () => registration } },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    $fetch: async (path, options) => {
      requests.push({ path, options });
      if (path.endsWith('vapid-public-key')) return { key: 'test' };
      if (path.endsWith('unsubscribe') && failDelete) throw new Error('offline');
      if (path.endsWith('/test') && failTest) throw new Error('Push service unavailable');
    },
    require: (name) => {
      if (name === 'pinia') return { defineStore: (_name, factory) => factory };
      if (name.endsWith('push.enums')) return enumExports;
      if (name.endsWith('pushDiagnostics')) return { reportPushFailure: (stage, error) => reports.push({ stage, error }) };
      if (name.endsWith('/error')) return { getErrorMessage: (error) => error.message };
      if (name.endsWith('pushSubscription'))
        return {
          waitForServiceWorker: async () => registration,
          urlBase64ToUint8Array: () => new Uint8Array(),
          getValidPushSubscription: async () => subscription,
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  runInNewContext(source, context);
  return {
    store: exports.usePushStore(),
    storage,
    requests,
    reports,
    notification,
    permissionRequests: () => permissionRequests,
  };
};

test('explicit device opt-out prevents reconnect and banner, including after reload', async () => {
  const { store, requests } = setup({ disabled: '1' });
  await store.sync(true);
  assert.equal(store.status.value, PushStatus.Disabled);
  assert.equal(store.showBanner.value, false);
  assert.equal(requests.length, 0);
});

test('enable requests permission and only reports enabled after server registration', async () => {
  const { store, storage, requests, permissionRequests } = setup({ disabled: '1' });
  await store.enable();
  assert.equal(permissionRequests(), 1);
  assert.equal(storage.has('push-device-disabled'), false);
  assert.equal(store.status.value, PushStatus.Enabled);
  assert.equal(store.enabled.value, true);
  assert.ok(requests.some(({ path }) => path === '/api/push/subscribe'));
});

test('blocked permission does not create a subscription', async () => {
  const { store, requests, reports } = setup({ permission: 'denied' });
  await store.enable();
  assert.equal(store.status.value, PushStatus.Blocked);
  assert.equal(requests.length, 0);
  assert.equal(reports.length, 0);
});

test('disable is endpoint-specific and background sync does not turn it back on', async () => {
  const { store, requests } = setup();
  await store.disable();
  await store.sync(true);
  assert.equal(store.status.value, PushStatus.Disabled);
  assert.equal(store.enabled.value, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body.endpoint, 'https://push.example/this-device');
});

test('local unsubscribe still disables delivery when server is unreachable', async () => {
  const { store, storage } = setup({ failDelete: true });
  await store.disable();
  assert.equal(store.status.value, PushStatus.Disabled);
  assert.equal(storage.get('push-device-disabled'), '1');
});

test('failed disable remains retryable after reload and does not falsely report off', async () => {
  const { store, storage } = setup({ failDelete: true, failUnsubscribe: true });
  await store.disable();
  assert.equal(store.status.value, PushStatus.Error);
  const reloaded = setup({ disabled: storage.get('push-device-disabled') });
  await reloaded.store.sync(true);
  assert.equal(reloaded.store.status.value, PushStatus.Error);
  assert.equal(reloaded.requests.length, 0);
});

test('test targets the current endpoint and does not claim delivery', async () => {
  const { store, requests } = setup();
  await store.enable();
  await store.test();
  const request = requests.find(({ path }) => path === '/api/push/test');
  assert.equal(request.options.body.endpoint, 'https://push.example/this-device');
  assert.match(store.message.value, /Запрос отправлен/);
});

test('test provider failures become visible errors', async () => {
  const { store, reports } = setup({ failTest: true });
  await store.enable();
  await store.test();
  assert.equal(store.status.value, PushStatus.Error);
  assert.equal(store.enabled.value, true);
  assert.equal(store.message.value, 'Push service unavailable');
  assert.equal(reports[0].stage, 'test_push');
});

test('unsubscribe failures report both original causes without a misleading read failure', async () => {
  const { store, reports } = setup({ failDelete: true, failUnsubscribe: true });
  await store.disable();
  assert.deepEqual(
    reports.map(({ stage }) => stage),
    ['unsubscribe_server', 'unsubscribe_browser'],
  );
});

test('diagnostics keep safe context, deduplicate and tolerate a broken monitoring client', () => {
  const events = [];
  const exports = {};
  let monitoringEnabled = false;
  let broken = false;
  runInNewContext(compile(new URL('../services/pushDiagnostics.ts', import.meta.url)), {
    exports,
    require: () => ({
      getClient: () => ({ getOptions: () => ({ dsn: monitoringEnabled ? 'configured' : undefined }) }),
      captureEvent: (event) => {
        if (broken) throw new Error('monitoring unavailable');
        events.push(event);
      },
    }),
    Notification: { permission: 'granted' },
    navigator: { onLine: true, serviceWorker: { controller: {} } },
    window: { isSecureContext: true, matchMedia: () => ({ matches: true }) },
  });
  const error = {
    name: 'FetchError',
    statusCode: 503,
    message: 'secret endpoint',
    stack: 'secret key',
    data: { auth: 'secret auth' },
  };
  exports.reportPushFailure('save_subscription', error);
  assert.equal(events.length, 0);
  monitoringEnabled = true;
  exports.reportPushFailure('save_subscription', error);
  exports.reportPushFailure('save_subscription', error);
  assert.equal(events.length, 1);
  assert.equal(events[0].tags.http_status, '503');
  assert.equal(events[0].contexts.push.standalone, true);
  assert.doesNotMatch(JSON.stringify(events), /secret/);
  broken = true;
  assert.doesNotThrow(() => exports.reportPushFailure('test_push', error));
});

test('Sentry final filter strips automatically attached private context only for push events', () => {
  let options;
  runInNewContext(compile(new URL('../sentry.client.config.ts', import.meta.url)), {
    exports: {},
    require: (name) =>
      name === '#imports'
        ? { useRuntimeConfig: () => ({ public: { SENTRY_DSN: 'configured' } }) }
        : {
            init: (value) => {
              options = value;
            },
          },
  });
  const event = {
    tags: { feature: 'web_push' },
    breadcrumbs: ['secret'],
    request: { url: 'secret' },
    user: { email: 'secret' },
    extra: { endpoint: 'secret' },
    contexts: { push: { online: true } },
  };
  assert.doesNotMatch(JSON.stringify(options.beforeSend(event)), /secret/);
  assert.equal(event.contexts.push.online, true);
  const unrelated = { message: 'other', breadcrumbs: ['keep'] };
  assert.equal(options.beforeSend(unrelated).breadcrumbs[0], 'keep');
});

test('Sentry final filter strips private context for every SaaS event', () => {
  let options;
  runInNewContext(compile(new URL('../sentry.client.config.ts', import.meta.url)), {
    exports: {},
    require: (name) =>
      name === '#imports'
        ? { useRuntimeConfig: () => ({ public: { SENTRY_DSN: 'configured', tenancyEnabled: true } }) }
        : {
            init: (value) => {
              options = value;
            },
          },
  });
  const event = {
    message: 'Request failed',
    tags: { feature: 'git' },
    breadcrumbs: ['secret'],
    request: { data: { token: 'secret' } },
    user: { email: 'secret' },
    extra: { password: 'secret' },
  };
  const filtered = options.beforeSend(event);
  assert.doesNotMatch(JSON.stringify(filtered), /secret/);
  assert.equal(filtered.message, 'Request failed');
  assert.equal(filtered.tags.feature, 'git');
  assert.equal(options.sendDefaultPii, false);
});
