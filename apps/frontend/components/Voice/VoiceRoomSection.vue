<script setup lang="ts">
import type { VoiceRoom } from '@tracker/contracts';
import { Check, Ellipsis, Mic, MicOff, Pencil, Plus, Trash2 } from '@lucide/vue';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { ROLES } from '~/types/user';
import type { VoiceParticipant } from '~/composables/useVoiceRoom';

interface VoiceRoomPresenceEvent {
  roomId: number;
  participants: Omit<VoiceParticipant, 'muted'>[];
}

const voiceRoomStore = useVoiceRoomStore();
const userStore = useUserStore();
const { rooms, loading } = storeToRefs(voiceRoomStore);
const { users } = storeToRefs(userStore);
const { $toast, $webSocket } = useNuxtApp();
const { joinRoom, leaveRoom, activeRoomId, participants: activeParticipants, isConnecting, error } = useVoiceRoom();

const presenceByRoom = ref<Map<number, Omit<VoiceParticipant, 'muted'>[]>>(new Map());
const menuRoomId = ref<number | null>(null);
const menuTrigger = ref<HTMLButtonElement | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const menuPosition = ref({ left: '0px', top: '0px' });
const editorOpen = ref(false);
const deleteOpen = ref(false);
const editingRoom = ref<VoiceRoom | null>(null);
const roomPendingDelete = ref<VoiceRoom | null>(null);
const name = ref('');
const selectedMemberIds = ref<number[]>([]);
const saving = ref(false);
const deleting = ref(false);

const availableUsers = computed(() =>
  users.value
    .filter((user) => user.role === ROLES.admin || user.role === ROLES.employee)
    .slice()
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'ru')),
);

const roomRows = computed(() =>
  rooms.value.map((room) => ({
    ...room,
    activeParticipants: presenceByRoom.value.has(room.id)
      ? presenceByRoom.value.get(room.id) ?? []
      : room.active_participants,
  })),
);
const menuRoom = computed(() => roomRows.value.find((room) => room.id === menuRoomId.value) ?? null);

await useAsyncData('voice-room-sidebar', async () => {
  await Promise.all([voiceRoomStore.fetchRooms(), users.value.length ? Promise.resolve() : userStore.fetchUsers()]);
  return true;
});

const setPresence = (roomId: number, participants: Omit<VoiceParticipant, 'muted'>[]) => {
  const next = new Map(presenceByRoom.value);
  next.set(roomId, participants);
  presenceByRoom.value = next;
};

const handleWsEvent = (payload: { type: string; data: VoiceRoomPresenceEvent }) => {
  if (payload.type === 'voice_room_updated') {
    setPresence(payload.data.roomId, payload.data.participants);
    return;
  }
  if (payload.type === 'voice_rooms_changed') {
    void voiceRoomStore.fetchRooms().catch((cause: unknown) => $toast.error(getErrorMessage(cause)));
  }
};

onMounted(() => {
  if (activeRoomId.value !== null) setPresence(activeRoomId.value, [...activeParticipants.value]);
  $webSocket.on('event', handleWsEvent);
});

onUnmounted(() => {
  $webSocket.off('event', handleWsEvent);
});

watch(
  rooms,
  (nextRooms) => {
    if (activeRoomId.value !== null && !nextRooms.some((room) => room.id === activeRoomId.value)) {
      void leaveRoom();
    }
  },
  { deep: true },
);

const getInitials = (firstName: string, lastName = '') => `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

const getParticipantInitials = (name: string) => {
  const [firstName = '', lastName = ''] = name.split(' ').filter(Boolean);
  return getInitials(firstName, lastName);
};

const formatMembersCount = (count: number) => {
  const mod100 = count % 100;
  const mod10 = count % 10;
  let noun = 'участников';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) noun = 'участник';
    else if (mod10 >= 2 && mod10 <= 4) noun = 'участника';
  }
  return `${count} ${noun}`;
};

const closeRoomMenu = () => {
  menuRoomId.value = null;
  menuTrigger.value = null;
};

const toggleRoomMenu = (roomId: number, event: MouseEvent) => {
  if (menuRoomId.value === roomId) {
    closeRoomMenu();
    return;
  }
  menuTrigger.value = event.currentTarget as HTMLButtonElement;
  menuRoomId.value = roomId;
};

watch(menuRoomId, async (roomId, _, onCleanup) => {
  if (roomId === null) return;

  let disposed = false;
  let stopPositioning: (() => void) | undefined;
  onCleanup(() => {
    disposed = true;
    stopPositioning?.();
  });

  await nextTick();
  if (disposed || !menuTrigger.value || !menuElement.value) return;

  stopPositioning = autoUpdate(menuTrigger.value, menuElement.value, async () => {
    const { x, y } = await computePosition(menuTrigger.value!, menuElement.value!, {
      strategy: 'fixed',
      placement: 'bottom-end',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
    });
    if (!disposed) menuPosition.value = { left: `${x}px`, top: `${y}px` };
  });
});

const handleRoomClick = async (roomId: number) => {
  if (isConnecting.value) return;
  closeRoomMenu();
  if (activeRoomId.value === roomId) {
    await leaveRoom();
    return;
  }
  if (activeRoomId.value !== null) await leaveRoom();
  await joinRoom(roomId);
  if (error.value) $toast.error(error.value);
};

const openCreate = () => {
  editingRoom.value = null;
  name.value = '';
  selectedMemberIds.value = userStore.user ? [userStore.user.id] : [];
  closeRoomMenu();
  editorOpen.value = true;
};

const openEdit = (room: VoiceRoom) => {
  editingRoom.value = room;
  name.value = room.name;
  selectedMemberIds.value = room.members.map((member) => member.id);
  closeRoomMenu();
  editorOpen.value = true;
};

const toggleMember = (userId: number) => {
  if (userId === editingRoom.value?.owner_id || (!editingRoom.value && userId === userStore.user?.id)) return;
  selectedMemberIds.value = selectedMemberIds.value.includes(userId)
    ? selectedMemberIds.value.filter((id) => id !== userId)
    : [...selectedMemberIds.value, userId];
};

const submitRoom = async () => {
  if (!name.value.trim() || saving.value) return;
  saving.value = true;
  try {
    const payload = { name: name.value.trim(), member_ids: selectedMemberIds.value };
    if (editingRoom.value) {
      await voiceRoomStore.updateRoom(editingRoom.value.id, payload);
      $toast.success('Комната обновлена');
    } else {
      await voiceRoomStore.createRoom(payload);
      $toast.success('Комната создана');
    }
    editorOpen.value = false;
  } catch (cause) {
    $toast.error(getErrorMessage(cause));
  } finally {
    saving.value = false;
  }
};

const requestDelete = (room: VoiceRoom) => {
  roomPendingDelete.value = room;
  closeRoomMenu();
  deleteOpen.value = true;
};

const confirmDelete = async () => {
  if (!roomPendingDelete.value || deleting.value) return;
  deleting.value = true;
  try {
    if (activeRoomId.value === roomPendingDelete.value.id) await leaveRoom();
    await voiceRoomStore.deleteRoom(roomPendingDelete.value.id);
    $toast.trash('Комната удалена');
    deleteOpen.value = false;
    roomPendingDelete.value = null;
  } catch (cause) {
    $toast.error(getErrorMessage(cause));
  } finally {
    deleting.value = false;
  }
};
</script>

<template>
  <section class="vrs" aria-labelledby="voice-rooms-title">
    <header class="vrs__header">
      <div class="vrs__heading">
        <span id="voice-rooms-title">Голосовые комнаты</span>
        <span v-if="roomRows.some((room) => room.activeParticipants.length)" class="vrs__live-dot" title="Есть участники в эфире" />
      </div>
      <button class="vrs__add" type="button" aria-label="Создать голосовую комнату" title="Создать комнату" @click="openCreate">
        <Plus :size="19" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </header>

    <div v-if="loading && !roomRows.length" class="vrs__empty" role="status">Загрузка комнат...</div>
    <div v-else-if="!roomRows.length" class="vrs__empty" role="status">
      <MicOff :size="20" :stroke-width="1.75" aria-hidden="true" />
      <span>Создайте первую комнату</span>
    </div>
    <ul v-else class="vrs__list">
      <li
        v-for="room in roomRows"
        :key="room.id"
        class="vrs__item"
        :class="{
          'vrs__item_active': activeRoomId === room.id,
          'vrs__item_live': room.activeParticipants.length > 0,
          'vrs__item_loading': isConnecting,
        }"
      >
        <button class="vrs__join" type="button" @click="handleRoomClick(room.id)">
          <span class="vrs__icon">
            <Mic :size="17" :stroke-width="1.75" aria-hidden="true" />
          </span>
          <span class="vrs__content">
            <span class="vrs__name">{{ room.name }}</span>
            <span class="vrs__meta">
              {{ room.activeParticipants.length ? `${room.activeParticipants.length} в эфире` : formatMembersCount(room.members.length) }}
            </span>
          </span>
          <span v-if="room.activeParticipants.length" class="vrs__avatars" aria-label="Участники в эфире">
            <span
              v-for="participant in room.activeParticipants.slice(0, 3)"
              :key="participant.userId"
              class="vrs__avatar"
              :title="participant.displayName"
            >
              <img v-if="participant.photoUrl" :src="participant.photoUrl" :alt="participant.displayName" />
              <span v-else>{{ getParticipantInitials(participant.displayName) }}</span>
            </span>
          </span>
        </button>

        <button
          v-if="room.can_manage"
          class="vrs__more"
          type="button"
          :aria-expanded="menuRoomId === room.id"
          :aria-label="`Действия с комнатой ${room.name}`"
          @click.stop="toggleRoomMenu(room.id, $event)"
        >
          <Ellipsis :size="19" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <Teleport to="body">
      <button
        v-if="menuRoom"
        class="vrs__menu-backdrop"
        type="button"
        aria-label="Закрыть меню"
        @click="closeRoomMenu"
      />
      <div
        v-if="menuRoom"
        ref="menuElement"
        class="vrs__menu"
        :style="menuPosition"
        role="menu"
        @click.stop
        @keydown.esc="closeRoomMenu"
      >
        <button type="button" role="menuitem" @click="openEdit(menuRoom)">
          <Pencil :size="17" :stroke-width="1.75" aria-hidden="true" />
          <span>Изменить</span>
        </button>
        <button type="button" role="menuitem" class="vrs__menu-danger" @click="requestDelete(menuRoom)">
          <Trash2 :size="17" :stroke-width="1.75" aria-hidden="true" />
          <span>Удалить</span>
        </button>
      </div>
    </Teleport>

    <BaseBottomSheet
      v-model="editorOpen"
      :title="editingRoom ? 'Изменить комнату' : 'Новая голосовая комната'"
      subtitle="Укажите название и участников"
      size="compact"
      :dismissible="!saving"
    >
      <form class="voice-room-form" @submit.prevent="submitRoom">
        <label class="voice-room-form__field">
          <span>Название</span>
          <input v-model="name" type="text" maxlength="120" autocomplete="off" placeholder="Например, Ежедневный созвон" />
        </label>

        <fieldset class="voice-room-form__members">
          <legend>Участники</legend>
          <label v-for="user in availableUsers" :key="user.id" class="voice-room-form__member">
            <input
              type="checkbox"
              :checked="selectedMemberIds.includes(user.id)"
              :disabled="user.id === editingRoom?.owner_id || (!editingRoom && user.id === userStore.user?.id)"
              @change="toggleMember(user.id)"
            />
            <span class="voice-room-form__avatar">
              <img v-if="user.photo_url" :src="user.photo_url" :alt="`${user.first_name} ${user.last_name}`" />
              <span v-else>{{ getInitials(user.first_name, user.last_name) }}</span>
            </span>
            <span class="voice-room-form__member-name">{{ user.first_name }} {{ user.last_name }}</span>
            <Check v-if="selectedMemberIds.includes(user.id)" :size="18" :stroke-width="2" aria-hidden="true" />
          </label>
        </fieldset>

        <div class="voice-room-form__actions">
          <button class="button_secondary" type="button" :disabled="saving" @click="editorOpen = false">Отмена</button>
          <button class="button" type="submit" :disabled="saving || !name.trim()">
            {{ saving ? 'Сохранение...' : editingRoom ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </form>
    </BaseBottomSheet>

    <BaseBottomSheet
      v-model="deleteOpen"
      title="Удалить комнату?"
      :subtitle="roomPendingDelete?.name ?? ''"
      size="compact"
      :dismissible="!deleting"
    >
      <div class="voice-room-delete">
        <p>Комната исчезнет у всех участников. Это действие нельзя отменить.</p>
        <div class="voice-room-delete__actions">
          <button class="button_secondary" type="button" :disabled="deleting" @click="deleteOpen = false">Отмена</button>
          <button class="voice-room-delete__confirm" type="button" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? 'Удаление...' : 'Удалить' }}
          </button>
        </div>
      </div>
    </BaseBottomSheet>
  </section>
</template>

<style scoped lang="scss">
.vrs {
  position: relative;
  width: 100%;
  min-width: 0;
  padding-top: 16px;
  border-top: 1px solid var(--light-text-backgroung-primary-10);
  @include flex(cn);
  gap: 8px;

  &__header,
  &__heading,
  &__join,
  &__avatars {
    @include flex(rn, a-center);
  }

  &__header {
    min-height: 40px;
    justify-content: space-between;
    gap: 8px;
  }

  &__heading {
    min-width: 0;
    gap: 8px;
    color: var(--text-secondary);
    @extend %h1;
  }

  &__live-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border-radius: 50%;
    background: var(--green);
  }

  &__add,
  &__more {
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @include flex(center);

    &:hover,
    &:focus-visible {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__add {
    width: 40px;
    height: 40px;
  }

  &__list {
    max-height: 224px;
    margin: 0;
    padding: 0 2px 0 0;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    @include flex(cn);
    gap: 4px;
  }

  &__item {
    position: relative;
    min-height: 52px;
    border-radius: 8px;
    @include flex(rn, a-center);
    transition: background-color 0.15s ease;

    &:hover,
    &_active {
      background: var(--light-text-backgroung-primary-5);
    }

    &_live .vrs__icon {
      background: var(--green-10);
      color: var(--green);
    }

    &_active .vrs__icon {
      background: var(--primary-25);
      color: var(--primary);
    }

    &_loading {
      pointer-events: none;
      opacity: 0.6;
    }
  }

  &__join {
    width: 100%;
    min-width: 0;
    min-height: 52px;
    padding: 6px 42px 6px 6px;
    gap: 10px;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__icon {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary-50);
    @include flex(center);
  }

  &__content {
    min-width: 0;
    flex: 1;
    @include flex(cn);
    gap: 2px;
  }

  &__name,
  &__meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__name {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__meta {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__avatars {
    flex-direction: row-reverse;
    flex: 0 0 auto;
    padding-left: 6px;
  }

  &__avatar {
    width: 22px;
    height: 22px;
    margin-left: -6px;
    overflow: hidden;
    border: 2px solid var(--dark-text-background-primary);
    border-radius: 50%;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    font-size: 8px;
    font-weight: 600;
    @include flex(center);

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__more {
    position: absolute;
    top: 6px;
    right: 4px;
    z-index: 2;
    width: 40px;
    height: 40px;
  }

  &__menu {
    position: fixed;
    z-index: 10002;
    width: 168px;
    padding: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    box-shadow: 0 12px 32px var(--black-50);

    button {
      width: 100%;
      min-height: 40px;
      padding: 8px 10px;
      gap: 9px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--light-text-backgroung-primary);
      text-align: left;
      cursor: pointer;
      @include flex(rn, a-center, j-start);
      @extend %text-s-regular;

      &:hover,
      &:focus-visible {
        background: var(--light-text-backgroung-primary-5);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }
    }

    .vrs__menu-danger {
      color: var(--danger-delete);
    }
  }

  &__menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
  }

  &__empty {
    min-height: 72px;
    padding: 12px;
    gap: 8px;
    color: var(--light-text-backgroung-primary-50);
    text-align: left;
    @include flex(rn, a-center);
    @extend %text-xs-regular;
  }

  @media (max-width: $screen-mobile-l) {
    padding-top: 12px;

    &__heading {
      @include display-xs-medium;
    }

    &__add,
    &__more {
      width: 44px;
      height: 44px;
    }

    &__list {
      max-height: 240px;
    }

    &__item,
    &__join {
      min-height: 56px;
    }
  }
}

.voice-room-form {
  padding: 0 16px 16px;
  @include flex(cn);
  gap: 20px;

  &__field {
    @include flex(cn);
    gap: 7px;

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-medium;
    }

    input {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      @extend %text-m-regular;

      &:focus {
        border-color: var(--primary);
        outline: none;
      }
    }
  }

  &__members {
    max-height: min(360px, 45dvh);
    margin: 0;
    padding: 0 4px 0 0;
    overflow-y: auto;
    border: 0;

    legend {
      margin-bottom: 8px;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-medium;
    }
  }

  &__member {
    min-height: 48px;
    padding: 6px 8px;
    gap: 10px;
    border-radius: 8px;
    cursor: pointer;
    @include flex(rn, a-center);

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:has(input:focus-visible) {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }

    svg {
      flex: 0 0 18px;
      color: var(--primary);
    }
  }

  &__avatar {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    overflow: hidden;
    border-radius: 50%;
    background: var(--primary-25);
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    @extend %text-xs-medium;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__member-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--light-text-backgroung-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-regular;
  }

  &__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;

    button {
      min-height: 44px;
    }
  }
}

.voice-room-delete {
  padding: 0 16px 16px;

  p {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-m-regular;
  }

  &__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 20px;

    button {
      min-height: 44px;
    }
  }

  &__confirm {
    border: 0;
    border-radius: 8px;
    background: var(--danger-delete);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-medium;

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }
  }
}
</style>
