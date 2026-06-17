interface ToastOptions {
  duration?: number;
}

declare module '#app' {
  interface NuxtApp {
    $toast: {
      (message: string, options?: ToastOptions): void;
      success: (message: string, options?: ToastOptions) => void;
      warning: (message: string, options?: ToastOptions) => void;
      error: (message: string, options?: ToastOptions) => void;
      trash: (message: string, options?: ToastOptions) => void;
      user: (message: string, options?: ToastOptions) => void;
    };
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $toast: {
      (message: string, options?: ToastOptions): void;
      success: (message: string, options?: ToastOptions) => void;
      warning: (message: string, options?: ToastOptions) => void;
      error: (message: string, options?: ToastOptions) => void;
      trash: (message: string, options?: ToastOptions) => void;
      user: (message: string, options?: ToastOptions) => void;
    };
  }
}

export {};
