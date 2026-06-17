<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { RecorderState } from '~/composables/useAudioRecorder';
import type { JSONContent } from '@tiptap/core';
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  createHighQualityMediaRecorder,
  getHighQualityAudioStream,
  resolveAudioRecordingExtension,
  stopAudioRecordingStream,
} from '~/utils/audioRecording';
import IconMicrophone from './Icons/IconMicrophone.vue';
import IconPause from './Icons/IconPause.vue';
import IconCofee from './Icons/IconCofee.vue';

type ParsedAudioTask = {
  title: string;
  description: JSONContent;
};

type AudioRecorderError = Error | DOMException;

const emit = defineEmits<{
  (e: 'done', payload: ParsedAudioTask): void;
  (e: 'error', err: AudioRecorderError): void;
  (e: 'cancel'): void;
}>();

const endpoint = '/api/tasks/parse-audio';
const MAX_SEC = 120;
const MIN_MS = 350;

const state = ref<RecorderState>(RecorderState.IDLE);
const hint = ref('Нажми и говори');

const mediaRecorder = ref<MediaRecorder | null>(null);
const streamRef = ref<MediaStream | null>(null);
const chunks: BlobPart[] = [];
const mimeType = ref<string>('');

const startedAt = ref(0);
const recordingMs = ref(0);
let rafId: number | null = null;
let autoStopTimer: number | null = null;

const tick = () => {
  recordingMs.value = Date.now() - startedAt.value;
  if (state.value === 'recording') rafId = requestAnimationFrame(tick);
};

const clearTimers = () => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (autoStopTimer) clearTimeout(autoStopTimer);
  autoStopTimer = null;
};

const cleanup = () => {
  clearTimers();
  stopAudioRecordingStream(streamRef.value);
  streamRef.value = null;
  mediaRecorder.value = null;
};

const waitStop = (rec: MediaRecorder) => {
  return new Promise<void>((resolve) => {
    if (rec.state === 'inactive') return resolve();
    rec.addEventListener('stop', () => resolve(), { once: true });
  });
};

const startRecording = async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      state.value = RecorderState.ERROR;
      hint.value = 'Микрофон недоступен (требуется HTTPS)';
      emit('error', new Error('MediaDevices API unavailable'));
      return;
    }
    if (mediaRecorder.value && mediaRecorder.value.state !== 'inactive') {
      try {
        mediaRecorder.value.stop();
      } catch {
        cleanup();
      }
    }
    cleanup();
    const stream = await getHighQualityAudioStream();
    streamRef.value = stream;

    const rec = createHighQualityMediaRecorder(stream);
    mimeType.value = rec.mimeType || 'audio/webm';
    mediaRecorder.value = rec;
    chunks.length = 0;

    rec.ondataavailable = (e) => e.data && chunks.push(e.data);

    rec.onstart = () => {
      state.value = RecorderState.RECORDING;
      hint.value = 'Говори. Нажми ещё раз, чтобы отправить';
      startedAt.value = Date.now();
      tick();
    };

    rec.start(AUDIO_RECORDING_TIMESLICE_MS);

    autoStopTimer = window.setTimeout(() => {
      if (state.value === RecorderState.RECORDING) stopAndSend();
    }, MAX_SEC * 1000);
  } catch (e) {
    const error = e instanceof Error || e instanceof DOMException ? e : new Error('Ошибка микрофона');
    state.value = RecorderState.ERROR;
    const name = error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      hint.value = 'Доступ к микрофону запрещён — разреши в браузере';
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      hint.value = 'Микрофон не найден';
    } else {
      hint.value = 'Ошибка микрофона';
    }
    console.error('[AudioRecorder]', name, error);
    emit('error', error);
  }
};

const cancelRecording = () => {
  if (state.value !== RecorderState.RECORDING) return;
  state.value = RecorderState.CANCELED;
  hint.value = 'Отменено';

  const rec = mediaRecorder.value;
  if (rec) {
    try {
      rec.stop();
      waitStop(rec).finally(() => cleanup());
    } catch {
      cleanup();
    }
  } else {
    cleanup();
  }

  chunks.length = 0;
  emit('cancel');
};

const stopAndSend = async () => {
  if (!mediaRecorder.value) return;

  const duration = Date.now() - startedAt.value;
  if (duration < MIN_MS) return cancelRecording();

  return new Promise<void>((resolve) => {
    const rec = mediaRecorder.value!;
    rec.onstop = async () => {
      cleanup();

      if (state.value === RecorderState.CANCELED) {
        chunks.length = 0;
        return resolve();
      }

      const type = mimeType.value || rec.mimeType || 'audio/webm';
      const ext = resolveAudioRecordingExtension(type);

      const file = new File([new Blob(chunks, { type })], `record.${ext}`, { type });

      state.value = RecorderState.SENDING;
      hint.value = 'Обработка…';

      try {
        const fd = new FormData();
        fd.append('audio', file);
        const config = useRuntimeConfig();

        const res = await $fetch<ParsedAudioTask>(config.public.API_URL + endpoint, {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });

        state.value = RecorderState.IDLE;
        hint.value = 'Нажми и говори';
        emit('done', res);
      } catch (e) {
        const error = e instanceof Error || e instanceof DOMException ? e : new Error('Ошибка отправки');
        state.value = RecorderState.ERROR;
        hint.value = 'Ошибка отправки';
        emit('error', error);
      } finally {
        chunks.length = 0;
        resolve();
        cleanup();
      }
    };

    try {
      rec.stop();
    } catch {
      cleanup();
      resolve();
    }
  });
};

const onClick = (e: MouseEvent) => {
  if (e.button !== 0) return;

  if (state.value === RecorderState.IDLE || state.value === RecorderState.ERROR || state.value === RecorderState.CANCELED) {
    startRecording();
  } else if (state.value === RecorderState.RECORDING) {
    stopAndSend();
  }
};

const isActiveState = (value: RecorderState) =>
  value === RecorderState.RECORDING || value === RecorderState.SENDING || value === RecorderState.ERROR;

onBeforeUnmount(() => {
  clearTimers();
  stopAudioRecordingStream(streamRef.value);
});
</script>

<template>
  <div class="mic-wrap">
    <button
      class="mic-btn"
      :class="{
        'mic-btn_rec': state === RecorderState.RECORDING,
        'mic-btn_sending': state === RecorderState.SENDING,
        'mic-btn_error': state === RecorderState.ERROR,
      }"
      :disabled="state === RecorderState.SENDING"
      @click="onClick"
      @contextmenu.prevent
    >
      <IconCofee v-if="state === RecorderState.SENDING" />
      <IconPause v-else-if="state === RecorderState.RECORDING" />
      <IconMicrophone v-else />
    </button>
    <button
      v-if="state === RecorderState.RECORDING"
      class="mic-cancel"
      title="Отменить запись"
      @click.stop="cancelRecording"
    >
      ✕
    </button>
    <div v-if="isActiveState(state)" class="mic-wrap__states">
      <span v-if="state === RecorderState.RECORDING">
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
          <circle cx="4" cy="4" r="4" fill="#FB1616" />
        </svg>
        Запись...
      </span>
      <span v-else-if="state === RecorderState.SENDING">Обработка…</span>
      <span v-else-if="state === RecorderState.ERROR">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mic-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  user-select: none;

  &__states {
    padding: 8px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);
    @extend %text-xs-regular;
    @include flex(rn, a-center);
    gap: 4px;
    span {
      @include flex(rn, a-center);
      gap: 4px;
    }
  }
}
.mic-btn {
  cursor: pointer;
  padding: 6px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--light-text-backgroung-primary-5);
  transition: background-color 0.2s ease;

  &:disabled {
    cursor: default;
  }

  &_rec {
    background-color: var(--primary);
  }

  &_sending {
    background-color: var(--primary-50);
  }

  &_error {
    background-color: var(--danger-delete);
  }
}
.mic-cancel {
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--light-text-backgroung-primary-5);
  color: var(--light-text-secondary);
  @extend %text-xs-regular;
  line-height: 1;
  @include flex(center);
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--danger-delete-10);
    color: var(--danger-delete);
  }
}
</style>
