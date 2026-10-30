/** Only Nitro can sign the incoming host. Never copy forwarded headers from a browser. */
export const useApiRequestHeaders = (): Record<string, string> => {
  if (import.meta.client) return {};
  const cookie = useRequestHeaders(['cookie']).cookie;
  const event = useRequestEvent();
  const signedHeaders = (event?.context.nervionTenantHeaders ?? {}) as Record<string, string>;
  if (String(useRuntimeConfig().public.tenancyEnabled) === 'true' && !signedHeaders['x-nervion-signature']) {
    throw createError({ statusCode: 400, statusMessage: 'Контекст пространства отсутствует' });
  }
  return { ...(cookie ? { cookie } : {}), ...signedHeaders };
};
