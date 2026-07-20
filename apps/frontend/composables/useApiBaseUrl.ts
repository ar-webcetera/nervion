export const useApiBaseUrl = (): string => {
  const config = useRuntimeConfig();
  return import.meta.server ? config.apiInternalUrl : config.public.API_URL;
};
