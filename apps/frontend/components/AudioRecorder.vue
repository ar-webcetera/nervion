<script setup lang="ts">
import { computed, nextTick, ref, onBeforeUnmount } from 'vue';
import { FilePenLine, ImagePlus, X } from '@lucide/vue';
import { RecorderState } from '~/composables/useAudioRecorder';
import type { JSONContent } from '@tiptap/core';
import { useAiStore } from '~/stores/aiStore';
import { getErrorMessage } from '~/utils/error';
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

type TaskSourceScreenshot = {
  id: string;
  file: File;
  previewUrl: string;
};

withDefaults(
  defineProps<{
    textInput?: boolean;
  }>(),
  {
    textInput: false,
  },
);

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
const aiStore = useAiStore();

const isTextModalOpen = ref(false);
const textDraft = ref('');
const textError = ref('');
const isParsingText = ref(false);
const textInputRef = ref<HTMLTextAreaElement | null>(null);
const screenshotInputRef = ref<HTMLInputElement | null>(null);
const screenshots = ref<TaskSourceScreenshot[]>([]);
const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024;
const MAX_SCREENSHOTS_TOTAL_SIZE = 15 * 1024 * 1024;
const SCREENSHOT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

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

const canOpenTextInput = computed(
  () =>
    !isParsingText.value &&
    state.value !== RecorderState.RECORDING &&
    state.value !== RecorderState.SENDING,
);

const openTextInput = async () => {
  if (!canOpenTextInput.value) return;

  textError.value = '';
  isTextModalOpen.value = true;
  await nextTick();
  textInputRef.value?.focus();
};

const closeTextInput = () => {
  if (isParsingText.value) return;
  isTextModalOpen.value = false;
  textError.value = '';
};

const getScreenshotId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const clearScreenshots = () => {
  screenshots.value.forEach((screenshot) => URL.revokeObjectURL(screenshot.previewUrl));
  screenshots.value = [];
};

const removeScreenshot = (id: string) => {
  const screenshot = screenshots.value.find((item) => item.id === id);
  if (screenshot) URL.revokeObjectURL(screenshot.previewUrl);
  screenshots.value = screenshots.value.filter((item) => item.id !== id);
  textError.value = '';
};

const addScreenshots = (files: File[]) => {
  textError.value = '';
  let totalSize = screenshots.value.reduce((sum, screenshot) => sum + screenshot.file.size, 0);

  for (const file of files) {
    if (screenshots.value.length >= MAX_SCREENSHOTS) {
      textError.value = `Можно добавить не больше ${MAX_SCREENSHOTS} скриншотов.`;
      break;
    }
    if (!SCREENSHOT_MIME_TYPES.has(file.type)) {
      textError.value = 'Поддерживаются скриншоты PNG, JPEG и WebP.';
      continue;
    }
    if (file.size === 0) {
      textError.value = 'Один из скриншотов пуст. Вставьте другое изображение.';
      continue;
    }
    if (file.size > MAX_SCREENSHOT_SIZE) {
      textError.value = 'Размер одного скриншота не должен превышать 5 МБ.';
      continue;
    }
    if (totalSize + file.size > MAX_SCREENSHOTS_TOTAL_SIZE) {
      textError.value = 'Общий размер скриншотов не должен превышать 15 МБ.';
      break;
    }

    screenshots.value.push({
      id: getScreenshotId(),
      file,
      previewUrl: URL.createObjectURL(file),
    });
    totalSize += file.size;
  }
};

const insertPastedText = (text: string) => {
  if (!text) return;
  const textarea = textInputRef.value;
  const start = textarea?.selectionStart ?? textDraft.value.length;
  const end = textarea?.selectionEnd ?? start;
  textDraft.value = `${textDraft.value.slice(0, start)}${text}${textDraft.value.slice(end)}`;
  nextTick(() => {
    textarea?.setSelectionRange(start + text.length, start + text.length);
  });
};

const handleTextPaste = (event: ClipboardEvent) => {
  const imageFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (imageFiles.length === 0) return;

  event.preventDefault();
  insertPastedText(event.clipboardData?.getData('text/plain') ?? '');
  addScreenshots(imageFiles);
};

const handleScreenshotSelect = (event: Event) => {
  const input = event.target as HTMLInputElement;
  addScreenshots(Array.from(input.files ?? []));
  input.value = '';
};

const parseText = async () => {
  const text = textDraft.value.trim();
  if (!text && screenshots.value.length === 0) {
    textError.value = 'Введите текст или добавьте хотя бы один скриншот.';
    textInputRef.value?.focus();
    return;
  }

  textError.value = '';
  isParsingText.value = true;
  try {
    const parsedTask = await aiStore.parseTextToTask(
      text,
      undefined,
      screenshots.value.map((screenshot) => screenshot.file),
    );
    emit('done', parsedTask);
    textDraft.value = '';
    clearScreenshots();
    isTextModalOpen.value = false;
  } catch (e) {
    textError.value = getErrorMessage(e);
  } finally {
    isParsingText.value = false;
  }
};

const isActiveState = (value: RecorderState) =>
  value === RecorderState.RECORDING || value === RecorderState.SENDING || value === RecorderState.ERROR;

onBeforeUnmount(() => {
  clearTimers();
  stopAudioRecordingStream(streamRef.value);
  clearScreenshots();
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
      :disabled="state === RecorderState.SENDING || isParsingText"
      type="button"
      aria-label="Записать задачу голосом"
      title="Записать задачу голосом"
      @click="onClick"
      @contextmenu.prevent
    >
      <IconCofee v-if="state === RecorderState.SENDING" aria-hidden="true" />
      <IconPause v-else-if="state === RecorderState.RECORDING" aria-hidden="true" />
      <IconMicrophone v-else aria-hidden="true" />
    </button>
    <button
      v-if="textInput"
      class="text-btn"
      type="button"
      :disabled="!canOpenTextInput"
      aria-label="Ввести задачу текстом"
      title="Ввести задачу текстом"
      @click="openTextInput"
    >
      <FilePenLine :size="20" :stroke-width="1.75" aria-hidden="true" />
    </button>
    <button
      v-if="state === RecorderState.RECORDING"
      class="mic-cancel"
      type="button"
      aria-label="Отменить запись"
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

    <BaseModal
      v-if="textInput"
      v-model="isTextModalOpen"
      :dismissible="!isParsingText"
      :show-close="false"
      @close="closeTextInput"
    >
      <form class="text-task" :aria-busy="isParsingText" @submit.prevent="parseText">
        <div class="text-task__header">
          <div class="text-task__heading">
            <h2 class="text-task__title">Сформировать задачу по материалам</h2>
            <p class="text-task__description">
              Добавьте описание и скриншоты. ИИ прочитает материалы и подготовит название и структуру задачи.
            </p>
          </div>
          <button
            class="text-task__close"
            type="button"
            :disabled="isParsingText"
            aria-label="Закрыть"
            title="Закрыть"
            @click="closeTextInput"
          >
            <X :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>

        <label class="text-task__field">
          <span>Описание задачи</span>
          <textarea
            ref="textInputRef"
            v-model="textDraft"
            name="task-source-text"
            rows="14"
            :disabled="isParsingText"
            :aria-describedby="textError ? 'text-task-error' : 'text-task-hint'"
            placeholder="Вставьте переписку, заметки или свободное описание задачи"
            @paste="handleTextPaste"
          ></textarea>
        </label>
        <div id="text-task-hint" class="text-task__source-actions">
          <p class="text-task__hint">Вставьте скриншот через Ctrl+V или выберите изображение.</p>
          <button
            class="text-task__add-screenshot"
            type="button"
            :disabled="isParsingText || screenshots.length >= MAX_SCREENSHOTS"
            @click="screenshotInputRef?.click()"
          >
            <ImagePlus :size="18" :stroke-width="1.75" aria-hidden="true" />
            Добавить скриншоты
          </button>
          <input
            ref="screenshotInputRef"
            class="text-task__file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            tabindex="-1"
            aria-hidden="true"
            @change="handleScreenshotSelect"
          />
        </div>

        <ul v-if="screenshots.length" class="text-task__screenshots" aria-label="Добавленные скриншоты">
          <li v-for="(screenshot, index) in screenshots" :key="screenshot.id" class="text-task__screenshot">
            <img
              :src="screenshot.previewUrl"
              :alt="`Скриншот ${index + 1}: ${screenshot.file.name}`"
              width="160"
              height="104"
            />
            <span :title="screenshot.file.name">{{ screenshot.file.name }}</span>
            <button
              type="button"
              :disabled="isParsingText"
              :aria-label="`Удалить скриншот ${index + 1}`"
              title="Удалить скриншот"
              @click="removeScreenshot(screenshot.id)"
            >
              <X :size="16" :stroke-width="1.75" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <p v-if="textError" id="text-task-error" class="text-task__error" role="alert">{{ textError }}</p>

        <div class="text-task__actions">
          <button class="text-task__cancel" type="button" :disabled="isParsingText" @click="closeTextInput">
            Отмена
          </button>
          <button
            class="text-task__submit"
            type="submit"
            :disabled="isParsingText || (!textDraft.trim() && screenshots.length === 0)"
          >
            <IconsIconButtonLoader v-if="isParsingText" class="text-task__loader" aria-hidden="true" />
            {{ isParsingText ? 'Формирую...' : 'Сформировать задачу' }}
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
.mic-wrap {
  @include flex(rn, a-center);
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

.mic-btn,
.text-btn {
  cursor: pointer;
  padding: 6px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--light-text-backgroung-primary-5);
  transition: background-color 0.2s ease;

  &:hover:not(:disabled) {
    background-color: var(--light-text-backgroung-primary-10);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.mic-btn {
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
.text-btn {
  color: var(--light-text-backgroung-primary-50);
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

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
}

:deep(.base-modal__content) {
  width: min(680px, calc(100vw - 32px));
}

.text-task {
  @include flex(cn);
  gap: 16px;
  width: 100%;
  min-width: 0;
  padding: 0 24px;
  box-sizing: border-box;
  color: var(--light-text-backgroung-primary);

  &__heading {
    @include flex(cn);
    gap: 6px;
    min-width: 0;
  }

  &__header {
    @include flex(rn, between, a-start);
    gap: 16px;
  }

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__description,
  &__hint,
  &__error {
    margin: 0;
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }

  &__close {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @include flex(center);
    transition: background-color 0.15s ease, color 0.15s ease;

    &:hover:not(:disabled) {
      background-color: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__description,
  &__hint {
    color: var(--light-text-backgroung-primary-50);
  }

  &__field {
    @include flex(cn);
    gap: 6px;
    min-width: 0;
    @extend %text-s-medium;

    textarea {
      @extend %ds-field;
      @extend %text-m-regular;
      min-height: var(--text-task-field-min-height, 280px);
      resize: vertical;

      &:disabled {
        opacity: 0.6;
        cursor: default;
      }
    }
  }

  &__hint {
    @extend %text-xs-regular;
  }

  &__source-actions {
    @include flex(rn, a-center, between);
    gap: 8px;
    flex-wrap: wrap;
    margin-top: -10px;
  }

  &__add-screenshot {
    @extend %ds-btn-secondary;
    min-height: 36px;
    padding: 8px 12px;

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
    }
  }

  &__file-input {
    display: none;
  }

  &__screenshots {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__screenshot {
    position: relative;
    min-width: 0;
    overflow: hidden;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);

    img {
      display: block;
      width: 100%;
      height: 104px;
      object-fit: cover;
    }

    span {
      display: block;
      min-width: 0;
      padding: 8px;
      overflow: hidden;
      color: var(--light-text-backgroung-primary-50);
      text-overflow: ellipsis;
      white-space: nowrap;
      @extend %text-xs-regular;
    }

    button {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--dark-text-background-primary);
      color: var(--light-text-backgroung-primary);
      cursor: pointer;
      @include flex(center);
      transition: background-color 0.15s ease, color 0.15s ease;

      &:hover:not(:disabled) {
        background: var(--danger-delete);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  &__error {
    padding-left: 12px;
    border-left: 2px solid var(--danger-delete);
  }

  &__actions {
    @include flex(rn, j-end, a-center);
    gap: 8px;
  }

  &__cancel {
    @extend %ds-btn-secondary;
  }

  &__submit {
    @extend %ds-btn-primary;
  }

  &__cancel:focus-visible,
  &__submit:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  &__cancel:active:not(:disabled),
  &__submit:active:not(:disabled) {
    transform: translateY(1px);
  }

  &__loader {
    width: 16px;
    height: 16px;
  }

  @media (max-width: $screen-mobile-l) {
    --text-task-field-min-height: min(34dvh, 260px);
    padding: 0 16px;

    &__actions {
      align-items: stretch;
      flex-direction: column;
    }

    &__cancel,
    &__submit {
      width: 100%;
      min-height: 44px;
    }

    &__close {
      width: 44px;
      min-height: 44px;
    }

    &__source-actions {
      align-items: stretch;
      flex-direction: column;
    }

    &__add-screenshot {
      width: 100%;
      min-height: 44px;
    }

    &__screenshots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &__screenshot button {
      width: 44px;
      height: 44px;
    }
  }
}

@media (pointer: coarse) {
  .mic-btn,
  .text-btn,
  .mic-cancel {
    width: 44px;
    height: 44px;
  }
}
</style>
