declare module 'vue-cal' {
  import type { DefineComponent } from 'vue';

  export function addDatePrototypes(): void;

  const VueCal: DefineComponent<object, object, object>;
  export default VueCal;
}
