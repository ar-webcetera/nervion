import type { ToastFunction } from '~/types/toast';

declare module '#app' {
  interface NuxtApp {
    $toast: ToastFunction;
  }
}

declare module '#app' {
  interface NuxtApp {
    $api: any;
  }
}
