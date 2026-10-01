import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getValidPushSubscription, urlBase64ToUint8Array, waitForServiceWorker } from '../services/pushSubscription.ts';

const key = new Uint8Array([1, 2, 3]);
const makeSubscription = (overrides = {}) => ({
  options: { applicationServerKey: key.buffer },
  expirationTime: null,
  toJSON: () => ({ keys: { p256dh: 'public-key', auth: 'auth-key' } }),
  unsubscribe: async () => true,
  ...overrides,
});

test('uses an active worker and does not wait for the timeout', async () => {
  const registration = { active: {} };
  assert.equal(await waitForServiceWorker({ ready: Promise.resolve(registration) }, 50), registration);
});

test('an inactive worker cannot block subscription retries indefinitely', async () => {
  await assert.rejects(waitForServiceWorker({ ready: new Promise(() => {}) }, 5), /activation timed out/);
});

test('keeps a valid subscription without subscribing again', async () => {
  const existing = makeSubscription();
  const registration = {
    pushManager: {
      getSubscription: async () => existing,
      subscribe: async () => assert.fail('Must reuse the existing subscription'),
    },
  };
  assert.equal(await getValidPushSubscription(registration, key), existing);
});

for (const [reason, overrides] of Object.entries({
  expired: { expirationTime: Date.now() - 1000 },
  'changed VAPID key': { options: { applicationServerKey: new Uint8Array([4, 5, 6]).buffer } },
  'missing VAPID key': { options: { applicationServerKey: null } },
  'missing encryption keys': { toJSON: () => ({ keys: {} }) },
})) {
  test(`replaces a subscription with ${reason}`, async () => {
    let unsubscribed = false;
    const existing = makeSubscription({
      ...overrides,
      unsubscribe: async () => {
        unsubscribed = true;
        return true;
      },
    });
    const created = makeSubscription();
    const registration = {
      pushManager: {
        getSubscription: async () => existing,
        subscribe: async (options) => {
          assert.equal(unsubscribed, true);
          assert.equal(options.userVisibleOnly, true);
          assert.deepEqual(new Uint8Array(options.applicationServerKey), key);
          return created;
        },
      },
    };
    assert.equal(await getValidPushSubscription(registration, key), created);
  });
}

test('propagates push service failure so the UI can offer retry', async () => {
  const registration = {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => {
        throw new Error('Push service unavailable');
      },
    },
  };
  await assert.rejects(getValidPushSubscription(registration, key), /Push service unavailable/);
});

test('rejects a new subscription without encryption keys', async () => {
  const registration = {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => makeSubscription({ toJSON: () => ({}) }),
    },
  };
  await assert.rejects(getValidPushSubscription(registration, key), /keys are missing/);
});

test('decodes URL-safe VAPID keys', () => {
  assert.deepEqual(urlBase64ToUint8Array('-_8'), new Uint8Array([251, 255]));
});
