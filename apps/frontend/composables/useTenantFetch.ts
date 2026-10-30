/** Capture request-local credentials once when a store or component is created. */
export const useTenantFetch = () => $fetch.create({
  baseURL: useApiBaseUrl(),
  headers: useApiRequestHeaders(),
  credentials: 'include',
});
