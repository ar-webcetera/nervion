export const waitForServiceWorker = (container: ServiceWorkerContainer, timeoutMs = 15000): Promise<ServiceWorkerRegistration> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Service worker activation timed out')), timeoutMs);
    container.ready.then(
      (registration) => {
        clearTimeout(timeout);
        resolve(registration);
      },
      (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

export const getValidPushSubscription = async (
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array,
): Promise<PushSubscription> => {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    const keys = existing.toJSON().keys;
    const currentKey = existing.options.applicationServerKey;
    const expectedKey = new Uint8Array(applicationServerKey);
    const matchesKey =
      currentKey !== null &&
      new Uint8Array(currentKey).length === expectedKey.length &&
      new Uint8Array(currentKey).every((byte, index) => byte === expectedKey[index]);
    const expired = existing.expirationTime !== null && existing.expirationTime <= Date.now();
    if (keys?.p256dh && keys.auth && matchesKey && !expired) return existing;
    await existing.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array(applicationServerKey).buffer,
  });
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('Push subscription keys are missing');
  return subscription;
};
