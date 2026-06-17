import { createApp, h } from 'vue';
import Toast from '../components/BaseToast.vue';

export enum ToastType {
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  TRASH = 'trash',
  USER = 'user',
}

export default defineNuxtPlugin((nuxtApp) => {
  const createToast = (message: string, type = ToastType.SUCCESS, options: { duration?: number } = {}) => {
    if (!document) return;
    const toastElement = document.createElement('div');
    document.body.appendChild(toastElement);

    const app = createApp({
      render: () => h(Toast, { message, type }),
    });

    const duration = options.duration || 3000;

    app.mount(toastElement);

    setTimeout(() => {
      app.unmount();
      document.body.removeChild(toastElement);
    }, duration);
  };

  const toast = (message: string, options = {}) => createToast(message, ToastType.SUCCESS, options);

  toast.success = (message: string, options = {}) => createToast(message, ToastType.SUCCESS, options);
  toast.warning = (message: string, options = {}) => createToast(message, ToastType.WARNING, options);
  toast.error = (message: string, options = {}) => createToast(message, ToastType.ERROR, options);
  toast.trash = (message: string, options = {}) => createToast(message, ToastType.TRASH, options);
  toast.user = (message: string, options = {}) => createToast(message, ToastType.USER, options);

  nuxtApp.provide('toast', toast);
});
