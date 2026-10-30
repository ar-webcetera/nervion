/** Browser-facing links must stay on the current tenant's origin. */
export const usePublicApiBaseUrl = (): string => {
  const config = useRuntimeConfig();
  return String(config.public.tenancyEnabled) === 'true' ? '' : String(config.public.API_URL ?? '');
};
