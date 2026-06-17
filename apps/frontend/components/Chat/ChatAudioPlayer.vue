<script setup lang="ts">
import { activateAudioPlayback, clearActiveAudioPlayback } from '~/utils/tiptap/audioPlaybackCoordinator';

const props = defineProps<{ src: string; duration?: number }>();

const src = computed<string>(() => props.src);
const totalDuration = computed<number>(() => props.duration ?? 0);

const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const loadedDuration = ref(totalDuration.value);

// Транскрипция
const config = useRuntimeConfig();
const transcriptionText = ref<string | null>(null);
const isTranscribing = ref(false);
const transcriptionError = ref(false);
const isTranscriptionExpanded = ref(true);

const formatTime = (seconds: number) => {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
};

const displayDuration = computed(() => {
  if (loadedDuration.value > 0) return formatTime(loadedDuration.value);
  if (totalDuration.value > 0) return formatTime(totalDuration.value);
  return '0:00';
});

const progress = computed(() => {
  const dur = loadedDuration.value || totalDuration.value;
  if (!dur) return 0;
  return (currentTime.value / dur) * 100;
});

const hasError = ref(false);

const resetPlaybackState = () => {
  isPlaying.value = false;
  currentTime.value = 0;
};

const onPlay = () => {
  const currentAudio = audioRef.value;
  if (!currentAudio) return;

  activateAudioPlayback({
    element: currentAudio,
    reset: resetPlaybackState,
  });
  isPlaying.value = true;
};

const onPause = () => {
  isPlaying.value = false;
  clearActiveAudioPlayback(audioRef.value);
};

const togglePlay = () => {
  const audio = audioRef.value;
  if (!audio) return;
  if (isPlaying.value) {
    audio.pause();
  } else {
    if (audio.ended || (isFinite(audio.duration) && audio.currentTime >= audio.duration)) {
      audio.currentTime = 0;
      currentTime.value = 0;
    }
    hasError.value = false;
    audio.play().catch(() => {
      // Если браузер ещё не загрузил — дождёмся canplay и повторим
      audio.load();
      audio.addEventListener('canplay', () => void audio.play(), { once: true });
    });
  }
};

const onTimeUpdate = () => {
  if (audioRef.value) currentTime.value = audioRef.value.currentTime;
};

const onLoadedMetadata = () => {
  if (audioRef.value && isFinite(audioRef.value.duration)) {
    loadedDuration.value = audioRef.value.duration;
  }
};

const onEnded = () => {
  if (audioRef.value) {
    audioRef.value.currentTime = 0;
    clearActiveAudioPlayback(audioRef.value);
  }
  isPlaying.value = false;
  currentTime.value = 0;

  const messageEl = audioRef.value?.closest('[data-message-id]') ?? audioRef.value?.closest('.fchat-msg');
  if (!messageEl) return;
  const nextMessageEl = messageEl.previousElementSibling;
  if (!nextMessageEl) return;
  const nextAudio = nextMessageEl.querySelector('.audio-message audio') as HTMLAudioElement | null;
  if (nextAudio) {
    nextAudio.currentTime = 0;
    void nextAudio.play();
  }
};

const onProgressClick = (e: MouseEvent) => {
  const audio = audioRef.value;
  if (!audio) return;
  const bar = e.currentTarget as HTMLElement;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const dur = Number.isFinite(audio.duration) ? audio.duration : loadedDuration.value || totalDuration.value;
  if (!dur || !Number.isFinite(dur)) return;
  const targetTime = ratio === 1 ? Math.max(0, dur - 0.01) : ratio * dur;
  audio.currentTime = targetTime;
  currentTime.value = targetTime;
};

const requestTranscription = async () => {
  if (isTranscribing.value || transcriptionText.value) return;
  isTranscribing.value = true;
  transcriptionError.value = false;

  try {
    const result = await $fetch<{ text: string }>(config.public.API_URL + '/api/chats/transcribe-audio', {
      method: 'POST',
      body: { audioUrl: src.value },
      credentials: 'include',
    });
    transcriptionText.value = result.text;
    isTranscriptionExpanded.value = true;
  } catch {
    transcriptionError.value = true;
  } finally {
    isTranscribing.value = false;
  }
};

const toggleTranscription = () => {
  if (transcriptionText.value) {
    isTranscriptionExpanded.value = !isTranscriptionExpanded.value;
  }
};

onBeforeUnmount(() => {
  clearActiveAudioPlayback(audioRef.value);
});
</script>

<template>
  <div class="audio-message">
    <audio
      ref="audioRef"
      :src="src"
      preload="none"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="hasError = true"
    />
    <div class="audio-message__row">
      <button class="audio-message__play" @click="togglePlay">
        <svg v-if="!isPlaying" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6.5 5.5l9 4.5-9 4.5V5.5z" />
        </svg>
        <svg v-else viewBox="0 0 20 20" fill="currentColor">
          <rect x="5" y="4" width="3.5" height="12" rx="1" />
          <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
        </svg>
      </button>
      <div class="audio-message__body">
        <div class="audio-message__progress" @click="onProgressClick">
          <div class="audio-message__bar" :style="{ width: `${progress}%` }" />
        </div>
        <div class="audio-message__time">
          {{ isPlaying ? formatTime(currentTime) : displayDuration }}
        </div>
      </div>
      <!-- Кнопка транскрипции сбоку от плеера -->
      <button
        v-if="!transcriptionText && !isTranscribing"
        class="audio-message__transcribe-btn"
        :class="{ 'audio-message__transcribe-btn_error': transcriptionError }"
        :title="transcriptionError ? 'Ошибка. Повторить?' : 'Расшифровать'"
        @click="requestTranscription"
      >
        <svg viewBox="0.5 2 12 13" fill="currentColor" width="18" height="18">
          <path d="M3.2 12L5.6 5h1.3L9.3 12H8l-.6-1.8H5.1L4.5 12H3.2zm2.2-3h1.7L6.25 6.2h-.05L5.4 9z" />
        </svg>
      </button>
      <span v-if="isTranscribing" class="audio-message__spinner" title="Распознаю..." />
      <button
        v-if="transcriptionText"
        class="audio-message__toggle-btn"
        :title="isTranscriptionExpanded ? 'Свернуть' : 'Развернуть'"
        @click="toggleTranscription"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          width="14"
          height="14"
          class="audio-message__toggle-icon"
          :class="{ 'audio-message__toggle-icon_collapsed': !isTranscriptionExpanded }"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <!-- Текст транскрипции на всю ширину -->
    <p v-if="transcriptionText && isTranscriptionExpanded" class="audio-message__text">
      {{ transcriptionText }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.audio-message {
  display: flex;
  flex-direction: column;
  padding: 6px 4px;
  min-width: 200px;
  max-width: 300px;

  &__row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__play {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--primary-50);
    }

    svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__progress {
    height: 4px;
    background-color: var(--light-text-backgroung-primary-10);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  &__bar {
    height: 100%;
    background-color: var(--primary);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  &__time {
    font-size: 10px;
    color: var(--white-50);
    line-height: 1;
  }

  &__transcribe-btn,
  &__toggle-btn {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 6px;
    border: none;
    background-color: var(--light-text-backgroung-primary-5);
    color: var(--white-50);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;

    svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    &:hover {
      color: var(--primary);
      background-color: var(--light-text-backgroung-primary-10);
    }
  }

  &__transcribe-btn_error {
    color: var(--danger-delete);

    &:hover {
      color: var(--danger-delete);
      background-color: var(--danger-delete-10);
    }
  }

  &__spinner {
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--light-text-backgroung-primary-10);
    border-top-color: var(--primary);
    border-radius: 50%;
    flex-shrink: 0;
    animation: spin 0.6s linear infinite;
  }

  &__toggle-icon {
    transition: transform 0.15s ease;

    &_collapsed {
      transform: rotate(-90deg);
    }
  }

  &__text {
    margin: 4px 0 0;
    padding-top: 4px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-xs-regular;
    line-height: 1.4;
    color: var(--light-text-backgroung-primary);
    word-break: break-word;
    opacity: 0.85;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
