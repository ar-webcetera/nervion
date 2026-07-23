import { defineStore } from 'pinia';
import type { ReadNotificationContextRequest, ReadNotificationContextResponse } from '@tracker/contracts';
import type { Notification } from '~/types/notification';

export const useNotificationStore = defineStore('notification', () => {
  const config = useRuntimeConfig();
  const notifications = ref<Notification[]>([]);

  const syncMailUnreadCount = async () => {
    const mailStore = useMailStore();
    await mailStore.fetchUnreadCount().catch(() => {});
  };

  const getAllNotifications = async () => {
    const headers = useRequestHeaders(['cookie']);
    notifications.value = await $fetch<Notification[]>(`/api/notifications/`, {
      headers,
      credentials: 'include',
      baseURL: config.public.API_URL,
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
    await $fetch(`/api/notifications/${id}/`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });

    updateLocaleNotification(id, params);
    if (params.is_read) {
      await syncMailUnreadCount();
    }
  };

  const markContextAsRead = async (context: ReadNotificationContextRequest): Promise<number[]> => {
    const response = await $fetch<ReadNotificationContextResponse>(`/api/notifications/read-context`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
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
    await $fetch(`/api/notifications/mark-all-read`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
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
