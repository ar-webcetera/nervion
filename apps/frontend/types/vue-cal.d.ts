declare module 'vue-cal' {
  import type { DefineComponent } from 'vue';

  export function addDatePrototypes(): void;

  const VueCal: DefineComponent<any, any, any>;
  export default VueCal;
}
