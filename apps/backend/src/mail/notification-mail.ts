import { requireTenantContext } from '../tenancy/tenant-context.service';

export const buildNotificationMessageId = (notificationId: number): string => {
  const tenant = process.env.TENANCY_ENABLED === 'true' ? `${requireTenantContext().tenant.id}-` : '';
  return `nervion-notification-${tenant}${notificationId}@nervion.local`;
};
