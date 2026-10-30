import { defineStore } from 'pinia';
import type { TenantDescriptor } from '@tracker/contracts';
import type { ROLES } from '~/types/user';
import { getTenantLandingPath, getTenantMenuFeature, getTenantRouteFeature, isTenantFeatureEnabled } from '~/utils/tenantFeatures';

export const useTenantStore = defineStore('tenant', () => {
  const api = useTenantFetch();
  const enabled = String(useRuntimeConfig().public.tenancyEnabled) === 'true';
  const tenant = ref<TenantDescriptor | null>(null);
  const readOnly = computed(() => tenant.value?.readOnly ?? false);
  const load = async () => {
    tenant.value = enabled ? await api<TenantDescriptor>('/api/tenant/context') : null;
  };
  const canUse = (feature: string): boolean => {
    if (!enabled) return true;
    return isTenantFeatureEnabled(tenant.value?.featureFlags, feature);
  };
  const menuAllowed = (key: string): boolean => canUse(getTenantMenuFeature(key));
  const routeAllowed = (path: string): boolean => canUse(getTenantRouteFeature(path));
  const getLandingPath = (role?: ROLES): string => getTenantLandingPath(canUse, role);
  return { tenant, enabled, readOnly, load, canUse, menuAllowed, routeAllowed, getLandingPath };
});
