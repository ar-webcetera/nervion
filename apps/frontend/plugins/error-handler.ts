export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
    console.error('SSR Error:', error);
    console.error('Vue component:', instance?.$options.name);
    console.error('Error info:', info);
  };

  nuxtApp.hook('vue:error', (error) => {
    console.error('SSR Vue Error Hook:', error);
  });
});
