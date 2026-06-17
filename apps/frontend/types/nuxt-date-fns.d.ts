export {};

declare module '#app' {
  interface NuxtApp {
    $dateFns: typeof import('date-fns');
  }
  interface ComponentCustomProperties {
    $dateFns: typeof import('date-fns');
  }
}
