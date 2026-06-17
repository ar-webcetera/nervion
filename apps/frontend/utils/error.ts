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
