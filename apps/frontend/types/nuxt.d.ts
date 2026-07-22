import type { ToastFunction } from '~/types/toast';

interface ApiClient {
  post: (url: string, body: object) => Promise<object>;
}

declare module '#app' {
  interface NuxtApp {
    $toast: ToastFunction;
  }
}

declare module '#app' {
  interface NuxtApp {
    $api: ApiClient;
  }
}
