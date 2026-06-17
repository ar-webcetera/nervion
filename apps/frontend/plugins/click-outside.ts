export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('click-outside', {
    mounted(el: HTMLElement, binding) {
      const onClick = (event: Event) => {
        if (!(el === event.target || el.contains(event.target as Node))) {
          binding.value(event);
        }
      };
      document.addEventListener('pointerdown', onClick, true);
      el._clickOutside = onClick;
    },
    beforeUnmount(el: HTMLElement) {
      if (el._clickOutside) {
        document.removeEventListener('pointerdown', el._clickOutside, true);
        delete el._clickOutside;
      }
    },
  });
});
