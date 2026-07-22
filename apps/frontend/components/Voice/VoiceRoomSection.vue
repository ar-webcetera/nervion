<script setup lang="ts">
import type { VoiceParticipant } from '~/composables/useVoiceRoom';

interface VoiceRoom {
  projectId: number;
  projectName: string;
  participants: Pick<VoiceParticipant, 'userId' | 'displayName' | 'photoUrl'>[];
}

const props = defineProps<{
  rooms: VoiceRoom[];
}>();

const { joinRoom, leaveRoom, activeProjectId, isConnecting } = useVoiceRoom();

const activeCount = computed(() => props.rooms.filter((room) => room.participants.length > 0).length);
const orderedRooms = computed(() => [...props.rooms].sort((a, b) => b.participants.length - a.participants.length));
const isExpanded = ref(false);

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.charAt(0).toUpperCase();
};

const handleClick = async (projectId: number) => {
  if (isConnecting.value) return;
  if (activeProjectId.value === projectId) {
    await leaveRoom();
  } else {
    if (activeProjectId.value !== null) await leaveRoom();
    await joinRoom(projectId);
  }
};
</script>

<template>
  <div class="vrs" :class="{ 'vrs--expanded': isExpanded }">
    <div class="vrs__header" @click="isExpanded = !isExpanded">
      <svg
        class="vrs__chevron"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path d="M6 4l4 4-4 4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>Голосовые комнаты</span>
      <span v-if="activeCount" class="vrs__live-badge">
        <span class="vrs__live-dot" />
        {{ activeCount }} в эфире
      </span>
    </div>

    <ul class="vrs__list">
      <li
        v-for="room in orderedRooms"
        v-show="room.participants.length > 0 || isExpanded"
        :key="room.projectId"
        class="vrs__item"
        :class="{
          'vrs__item--active': activeProjectId === room.projectId,
          'vrs__item--loading': isConnecting,
          'vrs__item--live': room.participants.length > 0,
        }"
        @click="handleClick(room.projectId)"
      >
        <span class="vrs__icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">
            <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke-width="1.3" stroke-linecap="round" />
            <path d="M3 7.5a5 5 0 0 0 10 0" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="8" y1="12.5" x2="8" y2="14.5" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </span>

        <span class="vrs__name">{{ room.projectName }}</span>

        <div v-if="room.participants.length > 0" class="vrs__avatars">
          <div
            v-for="(p, i) in room.participants.slice(0, 3)"
            :key="p.userId"
            class="vrs__avatar"
            :style="{ zIndex: 3 - i }"
            :title="p.displayName"
          >
            <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.displayName" />
            <span v-else>{{ getInitials(p.displayName) }}</span>
          </div>
          <span v-if="room.participants.length > 3" class="vrs__avatar vrs__avatar--more">
            +{{ room.participants.length - 3 }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.vrs {
  @include flex(cn);
  width: 100%;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--light-text-backgroung-primary-10);

  &__header {
    @include flex(rn, a-center);
    gap: 6px;
    padding: 4px 0;
    cursor: pointer;
    color: var(--text-secondary);
    @extend %h1;
    transition: color 0.15s;
    user-select: none;

    @media (max-width: $screen-mobile-l) {
      @include display-xs-medium;
    }

    &:hover {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__chevron {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    stroke: currentColor;
    transition: transform 0.2s;
    opacity: 0.5;
    margin-top: 1px;
  }

  &--expanded &__chevron {
    transform: rotate(90deg);
  }

  &__live-badge {
    @include flex(rn, a-center);
    gap: 5px;
    margin-left: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--green-10);
    color: var(--green);
    @extend %text-xs-medium;
    flex-shrink: 0;
  }

  &__live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--green);
    flex-shrink: 0;
    animation: vrs-pulse 1.6s ease-in-out infinite;
  }

  &__list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    @include flex(cn);
    gap: 1px;
    max-height: 200px;
    overflow-y: auto;
  }

  &__item {
    @include flex(rn, a-center);
    gap: 10px;
    padding: 10px 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s;
    min-width: 0;

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);

      .vrs__icon { opacity: 1; }
      .vrs__name { color: var(--light-text-backgroung-primary); }
    }

    &--active {
      background-color: var(--light-text-backgroung-primary-5);

      .vrs__icon { color: var(--primary); opacity: 1; }
      .vrs__name { color: var(--light-text-backgroung-primary); }
    }

    &--loading {
      pointer-events: none;
      opacity: 0.5;
    }

    &--live {
      background-color: var(--green-10);

      .vrs__icon {
        color: var(--green);
        opacity: 1;
      }
      .vrs__name {
        color: var(--light-text-backgroung-primary);
      }

      &:hover {
        background-color: var(--green-25);
      }
    }
  }

  &__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);

    svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
    }
  }

  &__name {
    flex: 1;
    min-width: 0;
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }

  &__avatars {
    @include flex(rn, a-center);
    flex-direction: row-reverse;
    flex-shrink: 0;
    margin-right: 4px;
  }

  &__avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--dark-text-background-primary);
    overflow: hidden;
    margin-left: -5px;
    background-color: var(--primary);
    @include flex(center);
    font-size: 7px;
    font-weight: 600;
    color: var(--light-text-backgroung-primary);

    &:last-child { margin-left: 0; }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    &--more {
      background-color: var(--light-text-backgroung-primary-10);
    }
  }
}

@keyframes vrs-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.85);
  }
}
</style>
