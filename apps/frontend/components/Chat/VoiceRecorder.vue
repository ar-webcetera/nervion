<script setup lang="ts">
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  createHighQualityMediaRecorder,
  getHighQualityAudioStream,
  resolveAudioRecordingExtension,
  stopAudioRecordingStream,
} from '~/utils/audioRecording';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';

const props = defineProps<{
  chatId: string;
  prefix: string;
}>();

const emit = defineEmits<{
  (e: 'send', src: string, duration: number): void;
  (e: 'cancel'): void;
}>();

const filesStore = useFilesStore();
const config = useRuntimeConfig();
const AWS_ENDPOINT = config.public.AWS_ENDPOINT;

type State = 'recording' | 'uploading';
const state = ref<State>('recording');

const elapsed = ref(0);
let intervalId: ReturnType<typeof setInterval> | null = null;

let mediaRecorder: MediaRecorder | null = null;
const chunks: BlobPart[] = [];

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
};

const startRecording = async () => {
  chunks.length = 0;
  const stream = await getHighQualityAudioStream();
  mediaRecorder = createHighQualityMediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.start(AUDIO_RECORDING_TIMESLICE_MS);

  intervalId = setInterval(() => {
    elapsed.value += 1;
    if (elapsed.value >= 300) stopAndSend();
  }, 1000);
};

const stopRecording = (): Promise<Blob> => {
  return new Promise((resolve) => {
    if (!mediaRecorder) return resolve(new Blob());
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
      stopAudioRecordingStream(mediaRecorder!.stream);
      resolve(blob);
    };
    mediaRecorder.stop();
  });
};

const stopAndSend = async () => {
  if (intervalId) clearInterval(intervalId);
  state.value = 'uploading';

  const blob = await stopRecording();
  const duration = elapsed.value;

  const ext = resolveAudioRecordingExtension(blob.type);
  const fileName = `voice_${Date.now()}.${ext}`;
  const file = new File([blob], fileName, { type: blob.type });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('prefix', props.prefix);

  const response = await filesStore.addFile(formData);
  const src = buildAwsObjectUrl(response.Key, AWS_ENDPOINT) ?? response.Key;
  emit('send', src, duration);
};

const cancel = () => {
  if (intervalId) clearInterval(intervalId);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const recorder = mediaRecorder;
    recorder.addEventListener('stop', () => stopAudioRecordingStream(recorder.stream), { once: true });
    mediaRecorder.stop();
  }
  emit('cancel');
};

onMounted(() => {
  void startRecording();
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const recorder = mediaRecorder;
    recorder.addEventListener('stop', () => stopAudioRecordingStream(recorder.stream), { once: true });
    mediaRecorder.stop();
  }
});
</script>

<template>
  <div class="voice-recorder">
    <template v-if="state === 'recording'">
      <span class="voice-recorder__dot" />
      <span class="voice-recorder__time">{{ formatTime(elapsed) }}</span>
      <button class="voice-recorder__send" title="Отправить" @click="stopAndSend">
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M4 10h12M12 6l4 4-4 4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="voice-recorder__cancel" title="Отмена" @click="cancel">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </template>
    <template v-else>
      <span class="voice-recorder__uploading">Отправка...</span>
    </template>
  </div>
</template>

<style scoped lang="scss">
.voice-recorder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  flex: 1;

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--danger-delete);
    flex-shrink: 0;
    animation: pulse 1s ease-in-out infinite;
  }

  &__time {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    min-width: 32px;
  }

  &__uploading {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__send,
  &__cancel {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color 0.15s ease;

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__send {
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    margin-left: auto;

    svg {
      stroke: var(--light-text-backgroung-primary);
    }

    &:hover {
      background-color: var(--primary-50);
    }
  }

  &__cancel {
    background-color: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary-50);

    &:hover {
      background-color: var(--light-text-backgroung-primary-10);
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
