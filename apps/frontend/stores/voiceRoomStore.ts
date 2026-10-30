import type { CreateVoiceRoomRequest, UpdateVoiceRoomRequest, VoiceRoom } from '@tracker/contracts';

export const useVoiceRoomStore = defineStore('voiceRoom', () => {
  const tenantFetch = useTenantFetch();
  const apiBaseUrl = useApiBaseUrl();
  const rooms = ref<VoiceRoom[]>([]);
  const loading = ref(false);

  const requestOptions = () => ({
    baseURL: apiBaseUrl,
    credentials: 'include' as const,
    headers: useApiRequestHeaders(),
  });

  const fetchRooms = async () => {
    loading.value = true;
    try {
      rooms.value = await tenantFetch<VoiceRoom[]>('/api/voice/rooms', requestOptions());
      return rooms.value;
    } finally {
      loading.value = false;
    }
  };

  const createRoom = async (data: CreateVoiceRoomRequest) => {
    const room = await tenantFetch<VoiceRoom>('/api/voice/rooms', {
      ...requestOptions(),
      method: 'POST',
      body: data,
    });
    rooms.value.push(room);
    return room;
  };

  const updateRoom = async (id: number, data: UpdateVoiceRoomRequest) => {
    const room = await tenantFetch<VoiceRoom>(`/api/voice/rooms/${id}`, {
      ...requestOptions(),
      method: 'PATCH',
      body: data,
    });
    const index = rooms.value.findIndex((item) => item.id === id);
    if (index === -1) rooms.value.push(room);
    else rooms.value.splice(index, 1, room);
    return room;
  };

  const deleteRoom = async (id: number) => {
    await tenantFetch(`/api/voice/rooms/${id}`, {
      ...requestOptions(),
      method: 'DELETE',
    });
    rooms.value = rooms.value.filter((room) => room.id !== id);
  };

  return { rooms, loading, fetchRooms, createRoom, updateRoom, deleteRoom };
});
