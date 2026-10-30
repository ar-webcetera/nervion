import { defineStore } from 'pinia';
import type { ReadNotificationContextRequest, ReadNotificationContextResponse } from '@tracker/contracts';
import type { Notification } from '~/types/notification';

export const useNotificationStore = defineStore('notification', () => {
  const tenantFetch = useTenantFetch();
  const apiBaseUrl = useApiBaseUrl();
  const notifications = ref<Notification[]>([]);
  const selectedMailAccountId = useState<number>('mail-selected-account-id', () => 0);

  const syncMailUnreadCount = async () => {
    if (!selectedMailAccountId.value) return;
    const mailStore = useMailStore();
    await mailStore.fetchAccountUnreadCount(selectedMailAccountId.value).catch(() => {});
  };

  const getAllNotifications = async () => {
    const headers = useApiRequestHeaders();
    notifications.value = await tenantFetch<Notification[]>(`/api/notifications/`, {
      headers,
      credentials: 'include',
      baseURL: apiBaseUrl,
    });

    notifications.value.sort((a, b) => {
      if (a.is_read === b.is_read) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return a.is_read ? 1 : -1;
    });
  };

  const updateLocaleNotification = (id: number, params: Partial<Notification>) => {
    const notificationIndex = notifications.value.findIndex((n) => n.id === id);
    if (notificationIndex !== -1) {
      notifications.value[notificationIndex].is_read = params.is_read ?? notifications.value[notificationIndex].is_read;

      notifications.value.sort((a, b) => {
        if (a.is_read === b.is_read) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        return a.is_read ? 1 : -1;
      });
    }
  };

  const updateNotifications = async (id: number, params: Partial<Notification>) => {
    const body: Partial<Notification> = {};
    if ('is_read' in params) body.is_read = params.is_read;
    await tenantFetch(`/api/notifications/${id}/`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: apiBaseUrl,
      body,
    });

    updateLocaleNotification(id, params);
    if (params.is_read) {
      await syncMailUnreadCount();
    }
  };

  const markContextAsRead = async (context: ReadNotificationContextRequest): Promise<number[]> => {
    const response = await tenantFetch<ReadNotificationContextResponse>(`/api/notifications/read-context`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: apiBaseUrl,
      body: context,
    });

    response.notification_ids.forEach((id) => {
      updateLocaleNotification(id, { is_read: true });
    });
    if (response.notification_ids.length > 0) {
      await syncMailUnreadCount();
    }

    return response.notification_ids;
  };

  const markAllAsRead = async () => {
    await tenantFetch(`/api/notifications/mark-all-read`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: apiBaseUrl,
    });
    await syncMailUnreadCount();
  };
  return {
    getAllNotifications,
    notifications,
    updateNotifications,
    markContextAsRead,
    markAllAsRead,
    updateLocaleNotification,
  };
});
