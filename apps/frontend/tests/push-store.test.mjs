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
  return { store: exports.usePushStore(), storage, requests, notification, permissionRequests: () => permissionRequests };
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
  assert.ok(requests.some(({ path }) => path === '/api/push/subscribe'));
});

test('blocked permission does not create a subscription', async () => {
  const { store, requests } = setup({ permission: 'denied' });
  await store.enable();
  assert.equal(store.status.value, PushStatus.Blocked);
  assert.equal(requests.length, 0);
});

test('disable is endpoint-specific and background sync does not turn it back on', async () => {
  const { store, requests } = setup();
  await store.disable();
  await store.sync(true);
  assert.equal(store.status.value, PushStatus.Disabled);
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
  const { store } = setup({ failTest: true });
  await store.enable();
  await store.test();
  assert.equal(store.status.value, PushStatus.Error);
  assert.equal(store.message.value, 'Push service unavailable');
});
