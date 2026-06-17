import { defineStore } from 'pinia';
import type { Notification } from '~/types/notification';

export const useNotificationStore = defineStore('notification', () => {
  const config = useRuntimeConfig();
  const notifications = ref<Notification[]>([]);

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
  };

  const markAllAsRead = async () => {
    await $fetch(`/api/notifications/mark-all-read`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
  };
  return { getAllNotifications, notifications, updateNotifications, markAllAsRead, updateLocaleNotification };
});
