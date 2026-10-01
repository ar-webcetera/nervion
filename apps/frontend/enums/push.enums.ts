export enum PushStatus {
  Checking = 'checking',
  Unsupported = 'unsupported',
  Blocked = 'blocked',
  Disabled = 'disabled',
  Enabled = 'enabled',
  Error = 'error',
}
export enum PushFailureStage {
  PublicKey = 'public_key',
  ServiceWorker = 'service_worker',
  BrowserSubscription = 'browser_subscription',
  SaveSubscription = 'save_subscription',
  Permission = 'permission',
  ReadSubscription = 'read_subscription',
  UnsubscribeServer = 'unsubscribe_server',
  UnsubscribeBrowser = 'unsubscribe_browser',
  Test = 'test_push',
}
