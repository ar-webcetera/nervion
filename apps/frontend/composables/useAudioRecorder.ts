import { ref } from 'vue';
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  createHighQualityMediaRecorder,
  getHighQualityAudioStream,
  resolveAudioRecordingExtension,
  stopAudioRecordingStream,
} from '~/utils/audioRecording';

export enum RecorderState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PAUSED = 'paused',
  CANCELED = 'canceled',
  ERROR = 'error',
  SENDING = 'sending',
}

export const useAudioRecorder = () => {
  const state = ref<RecorderState>(RecorderState.IDLE);
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const chunks: BlobPart[] = [];
  const streamRef = ref<MediaStream | null>(null);
  const mimeType = ref<string>('');

  const start = async () => {
    if (state.value !== RecorderState.IDLE) return;
    const stream = await getHighQualityAudioStream();
    streamRef.value = stream;
    const rec = createHighQualityMediaRecorder(stream);
    mimeType.value = rec.mimeType;
    mediaRecorder.value = rec;
    chunks.length = 0;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstart = () => (state.value = RecorderState.RECORDING);
    rec.onpause = () => (state.value = RecorderState.PAUSED);
    rec.onresume = () => (state.value = RecorderState.RECORDING);
    rec.onstop = () => (state.value = RecorderState.IDLE);

    rec.start(AUDIO_RECORDING_TIMESLICE_MS);
  };

  const pause = () => {
    if (mediaRecorder.value && state.value === RecorderState.RECORDING) mediaRecorder.value.pause();
  };

  const resume = () => {
    if (mediaRecorder.value && state.value === RecorderState.PAUSED) mediaRecorder.value.resume();
  };

  const stop = () => {
    return new Promise((resolve) => {
      if (!mediaRecorder.value) return resolve(null);
      const rec = mediaRecorder.value;
      rec.onstop = () => {
        state.value = RecorderState.IDLE;
        stopAudioRecordingStream(streamRef.value);
        streamRef.value = null;

        const type = mimeType.value || rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const ext = resolveAudioRecordingExtension(type);
        const file = new File([blob], `record.${ext}`, { type });
        resolve(file);
      };
      rec.stop();
    });
  };

  return { state, start, pause, resume, stop, mimeType };
};
