import { createError, showError } from '#imports';

export interface HttpErrorShape {
  statusCode?: number;
  status?: number;
  response?: {
    status?: number;
  };
}

export const getErrorStatusCode = (error: unknown): number | null => {
  const value = error as HttpErrorShape;
  return value?.statusCode ?? value?.status ?? value?.response?.status ?? null;
};

export const raisePageError = (statusCode: number, statusMessage: string) => {
  const pageError = createError({ statusCode, statusMessage });
  if (import.meta.client) {
    showError(pageError);
    return;
  }
  throw pageError;
};

export const getErrorMessage = (e: unknown): string => {
  const err = e as {
    message: string;
    data: { message: string[] };
    response?: { data?: { message?: string[] | string } };
  };
  if (typeof err?.data?.message === 'string') {
    return err?.data?.message;
  }
  if (err?.data?.message?.length) {
    return err?.data?.message[0];
  }

  if (err?.response?.data?.message?.length) {
    return err.response.data.message[0];
  }

  return 'Произошла непредвиденная ошибка';
};
