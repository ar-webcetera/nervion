<script setup lang="ts">
import IconMic from '~/components/Icons/IconMic.vue';
import IconClose from '~/components/Icons/IconClose.vue';
import IconScreenShare from '~/components/Icons/IconScreenShare.vue';

const { leaveRoom, toggleMute, startScreenShare, stopScreenShare, activeProjectId, participants, isConnecting, isConnected, isMuted, isScreenSharing, screenShareStreams, ownScreenStream, error } =
  useVoiceRoom();
const projectStore = useProjectStore();

const isVisible = computed(() => activeProjectId.value !== null);

const projectName = computed(() => {
  if (!activeProjectId.value) return '';
  return projectStore.projects.find((p) => p.id === activeProjectId.value)?.name ?? `Проект ${activeProjectId.value}`;
});

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.charAt(0).toUpperCase();
};

const screenShareEntries = computed(() => Array.from(screenShareStreams.value.entries()));
const hasScreenShare = computed(() => screenShareEntries.value.length > 0 || ownScreenStream.value !== null);

const setVideoSrc = (el: Element | null, stream: MediaStream) => {
  if (!el) return;
  const video = el as HTMLVideoElement;
  if (video.srcObject === stream) return;
  video.srcObject = stream;
  video.play().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') {
      setTimeout(() => {
        if (video.paused && video.srcObject === stream) {
          video.play().catch(() => {});
        }
      }, 150);
      return;
    }
    console.warn('[VoicePanel] video play failed:', err);
  });
};

watch(isVisible, (val) => {
  if (!val) pos.value = null;
});

const panelRef = ref<HTMLElement | null>(null);
const pos = ref<{ x: number; y: number } | null>(null);
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
const panelWidth = ref(720);
const windowWidth = ref(window.innerWidth);

const panelStyle = computed(() => {
  if (!pos.value) return {};
  return { left: `${pos.value.x}px`, bottom: `${pos.value.y}px`, top: 'auto', right: 'auto', transform: 'translateX(-50%)' };
});

const expandedStyle = computed(() => {
  if (!hasScreenShare.value) return {};
  const clampedWidth = Math.min(panelWidth.value, windowWidth.value - 24);
  return { width: `${clampedWidth}px`, maxWidth: `${clampedWidth}px` };
});

const startDrag = (e: MouseEvent | TouchEvent) => {
  if (!panelRef.value) return;
  const rect = panelRef.value.getBoundingClientRect();
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  dragOffset.value = {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - rect.bottom,
  };
  isDragging.value = true;
};

const onMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  pos.value = {
    x: e.clientX - dragOffset.value.x,
    y: window.innerHeight - (e.clientY - dragOffset.value.y),
  };
};

const onTouchMove = (e: TouchEvent) => {
  if (!isDragging.value || !e.touches[0]) return;
  e.preventDefault();
  pos.value = {
    x: e.touches[0].clientX - dragOffset.value.x,
    y: window.innerHeight - (e.touches[0].clientY - dragOffset.value.y),
  };
};

const stopDrag = () => {
  isDragging.value = false;
  isResizing.value = false;
};

const onWindowResize = () => {
  windowWidth.value = window.innerWidth;
};

const isResizing = ref(false);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

const startResize = (e: MouseEvent) => {
  e.stopPropagation();
  isResizing.value = true;
  resizeStartX.value = e.clientX;
  resizeStartWidth.value = panelWidth.value;
};

const onResizeMove = (e: MouseEvent) => {
  if (!isResizing.value) return;
  const delta = (e.clientX - resizeStartX.value) * 2;
  const minWidth = 360;
  const maxWidth = window.innerWidth - 32;
  panelWidth.value = Math.max(minWidth, Math.min(maxWidth, resizeStartWidth.value + delta));
};

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', stopDrag);
  window.addEventListener('resize', onWindowResize);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', stopDrag);
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <Transition name="voice-panel">
    <div
      v-if="isVisible"
      ref="panelRef"
      class="vp"
      :class="{ 'vp--dragging': isDragging, 'vp--resizing': isResizing, 'vp--expanded': hasScreenShare }"
      :style="{ ...panelStyle, ...expandedStyle }"
      @mousedown="startDrag"
      @touchstart.passive="startDrag"
    >
      <Transition name="vp-video">
        <div v-if="hasScreenShare" class="vp__video-area">
          <div v-if="ownScreenStream" class="vp__video-wrap">
            <video
              :ref="(el) => setVideoSrc(el as Element | null, ownScreenStream!)"
              class="vp__video"
              autoplay
              muted
              playsinline
            />
            <span class="vp__video-badge">Вы</span>
          </div>
          <div v-for="[producerId, stream] in screenShareEntries" :key="producerId" class="vp__video-wrap">
            <video
              :ref="(el) => setVideoSrc(el as Element | null, stream)"
              class="vp__video"
              autoplay
              muted
              playsinline
            />
          </div>
          <div class="vp__resize-handle" @mousedown="startResize" />
        </div>
      </Transition>

      <div class="vp__bar">
        <div class="vp__left">
          <span class="vp__indicator" :class="{ 'vp__indicator--connecting': isConnecting, 'vp__indicator--error': !!error }" />
          <div class="vp__info">
            <span class="vp__status">
              <template v-if="error">Ошибка</template>
              <template v-else-if="isConnecting">Подключение…</template>
              <template v-else>На связи</template>
            </span>
            <span class="vp__name">{{ projectName }}</span>
          </div>
        </div>

        <div v-if="isConnected && participants.length > 0" class="vp__avatars">
          <div
            v-for="(p, i) in participants.slice(0, 5)"
            :key="p.userId"
            class="vp__avatar"
            :class="{ 'vp__avatar--muted': p.muted }"
            :style="{ zIndex: 5 - i }"
            :title="p.displayName"
          >
            <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.displayName" />
            <span v-else>{{ getInitials(p.displayName) }}</span>
          </div>
        </div>

        <div class="vp__controls" @mousedown.stop @touchstart.stop>
          <button
            v-if="isConnected"
            class="vp__btn"
            :class="{ 'vp__btn--muted': isMuted }"
            :title="isMuted ? 'Включить микрофон' : 'Выключить микрофон'"
            @click="toggleMute"
          >
            <IconMic />
          </button>
          <button
            v-if="isConnected"
            class="vp__btn"
            :class="{ 'vp__btn--active': isScreenSharing }"
            :title="isScreenSharing ? 'Остановить трансляцию' : 'Показать экран'"
            @click="isScreenSharing ? stopScreenShare() : startScreenShare()"
          >
            <IconScreenShare />
          </button>
          <button class="vp__btn vp__btn--leave" title="Покинуть комнату" @click="leaveRoom">
            <IconClose />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.vp {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  @include flex(cn);
  background-color: var(--dark-text-background-primary);
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  box-shadow: 0 8px 32px var(--black-40);
  min-width: 240px;
  max-width: min(480px, calc(100vw - 24px));
  overflow: hidden;
  transition: max-width 0.3s ease, width 0.05s ease;
  cursor: grab;

  @media (max-width: $screen-mobile-l) {
    left: 12px;
    right: 12px;
    bottom: 12px;
    transform: none;
    min-width: 0;
    max-width: none;
  }

  &--expanded {
    max-width: 720px;
    width: 720px;

    @media (max-width: $screen-mobile-l) {
      width: auto;
    }
  }

  &--dragging,
  &--resizing {
    cursor: grabbing;
    user-select: none;
    box-shadow: 0 12px 40px var(--black-60);
  }

  &--resizing {
    cursor: ew-resize;
    transition: none;
  }

  &__video-area {
    position: relative;
    width: 100%;
    background-color: var(--dark-text-background-primary);
    aspect-ratio: 16 / 9;
    @include flex(center);
    overflow: hidden;
    gap: 2px;
  }

  &__resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize !important;
    z-index: 10;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    &::after {
      content: '';
      position: absolute;
      right: 2px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 32px;
      border-radius: 2px;
      background-color: var(--light-text-backgroung-primary-30);
    }

    &:hover::after {
      background-color: var(--light-text-backgroung-primary-50);
    }
  }

  &__video-wrap {
    position: relative;
    flex: 1;
    height: 100%;
    overflow: hidden;
  }

  &__video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  &__video-badge {
    position: absolute;
    bottom: 6px;
    left: 8px;
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary);
    background-color: var(--black-50);
    padding: 2px 6px;
    border-radius: 4px;
    pointer-events: none;
  }

  &__bar {
    @include flex(rn, a-center);
    gap: 12px;
    padding: 8px 12px;
  }

  &__left {
    @include flex(rn, a-center);
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  &__indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--green);

    &--connecting {
      background-color: var(--status-in-progress);
      animation: pulse 1s ease-in-out infinite;
    }

    &--error {
      background-color: var(--danger-delete);
      animation: none;
    }
  }

  &__info {
    @include flex(cn);
    min-width: 0;
  }

  &__status {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    line-height: 1.2;
  }

  &__name {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  &__avatars {
    @include flex(rn, a-center);
    flex-direction: row-reverse;
    flex-shrink: 0;
  }

  &__avatar {
    position: relative;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid var(--dark-text-background-primary);
    overflow: hidden;
    margin-left: -6px;
    background-color: var(--primary);
    @include flex(center);
    font-size: 10px;
    font-weight: 600;
    color: var(--light-text-backgroung-primary);

    &:last-child {
      margin-left: 0;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    &--muted {
      opacity: 0.45;
    }
  }

  &__controls {
    @include flex(rn, a-center);
    gap: 4px;
    flex-shrink: 0;
  }

  &__btn {
    @include flex(center);
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: none;
    background-color: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    cursor: pointer !important;
    font-size: 18px;
    transition: background-color 0.15s;

    &:hover {
      background-color: var(--light-text-backgroung-primary-25);
    }

    &--muted {
      background-color: var(--danger-delete);
      color: var(--light-text-backgroung-primary);
      &:hover {
        background-color: var(--danger-delete-50);
      }
    }

    &--active {
      background-color: var(--green);
      color: var(--light-text-backgroung-primary);
      &:hover {
        background-color: var(--green-25);
      }
    }

    &--leave {
      background-color: var(--danger-delete);
      &:hover {
        background-color: var(--danger-delete-50);
      }

      :deep(svg) {
        width: 1em;
        height: 1em;
        fill: var(--light-text-backgroung-primary);
      }
    }
  }
}

.vp-video-enter-active,
.vp-video-leave-active {
  transition: opacity 0.25s ease, max-height 0.3s ease;
  max-height: 500px;
  overflow: hidden;
}

.vp-video-enter-from,
.vp-video-leave-to {
  opacity: 0;
  max-height: 0;
}

.voice-panel-enter-active,
.voice-panel-leave-active {
  transition: opacity 0.2s;
}
.voice-panel-enter-from,
.voice-panel-leave-to {
  opacity: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
