import type { CalendarEvent, CalendarUser, CreateCalendarEventRequest, UpdateCalendarEventRequest } from '@tracker/contracts';

export const useCalendarStore = defineStore('calendar', () => {
  const tenantFetch = useTenantFetch();
  const apiBaseUrl = useApiBaseUrl();
  const events = ref<CalendarEvent[]>([]);
  const users = ref<CalendarUser[]>([]);
  const loading = ref(false);

  const requestOptions = () => ({
    baseURL: apiBaseUrl,
    credentials: 'include' as const,
    headers: useApiRequestHeaders(),
  });

  const fetchEvents = async (from: string, to: string) => {
    loading.value = true;
    try {
      const params = new URLSearchParams({ from, to });
      const response = await tenantFetch<CalendarEvent[]>(`/api/calendar/events?${params.toString()}`, requestOptions());
      events.value = response ?? [];
      return events.value;
    } finally {
      loading.value = false;
    }
  };

  const fetchEvent = (id: number) =>
    tenantFetch<CalendarEvent>(`/api/calendar/events/${id}`, {
      ...requestOptions(),
      method: 'GET',
    });

  const fetchUsers = async () => {
    const response = await tenantFetch<CalendarUser[]>('/api/calendar/users', requestOptions());
    users.value = response ?? [];
    return users.value;
  };

  const createEvent = async (data: CreateCalendarEventRequest) => {
    const created = await tenantFetch<CalendarEvent>('/api/calendar/events', {
      ...requestOptions(),
      method: 'POST',
      body: data,
    });
    events.value.push(created);
    events.value.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return created;
  };

  const updateEvent = async (id: number, data: UpdateCalendarEventRequest) => {
    const updated = await tenantFetch<CalendarEvent>(`/api/calendar/events/${id}`, {
      ...requestOptions(),
      method: 'PATCH',
      body: data,
    });
    const index = events.value.findIndex((event) => event.id === id);
    if (index === -1) events.value.push(updated);
    else events.value.splice(index, 1, updated);
    events.value.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return updated;
  };

  const deleteEvent = async (id: number) => {
    await tenantFetch(`/api/calendar/events/${id}`, {
      ...requestOptions(),
      method: 'DELETE',
    });
    events.value = events.value.filter((event) => event.id !== id);
  };

  const acceptEvent = async (id: number) => {
    const updated = await tenantFetch<CalendarEvent>(`/api/calendar/events/${id}/accept`, {
      ...requestOptions(),
      method: 'POST',
    });
    const index = events.value.findIndex((event) => event.id === id);
    if (index === -1) events.value.push(updated);
    else events.value.splice(index, 1, updated);
    events.value.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return updated;
  };

  return { events, users, loading, fetchEvents, fetchEvent, fetchUsers, createEvent, updateEvent, deleteEvent, acceptEvent };
});
