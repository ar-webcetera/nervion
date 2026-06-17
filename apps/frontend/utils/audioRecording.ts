export const AUDIO_RECORDING_BITRATE = 192_000;
export const AUDIO_RECORDING_TIMESLICE_MS = 1000;

const MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
];

export const pickAudioRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';

  return MIME_TYPE_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
};

export const getHighQualityAudioConstraints = (): MediaTrackConstraints => {
  const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};

  return {
    ...(supported.channelCount ? { channelCount: { ideal: 1 } } : {}),
    ...(supported.sampleRate ? { sampleRate: { ideal: 48000 } } : {}),
    ...(supported.sampleSize ? { sampleSize: { ideal: 16 } } : {}),
    ...(supported.echoCancellation ? { echoCancellation: { ideal: false } } : {}),
    ...(supported.noiseSuppression ? { noiseSuppression: { ideal: false } } : {}),
    ...(supported.autoGainControl ? { autoGainControl: { ideal: false } } : {}),
  };
};

const stopStreamTracks = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

export const getHighQualityAudioStream = async () => {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: getHighQualityAudioConstraints(), video: false });
  } catch {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
};

export const stopAudioRecordingStream = (stream: MediaStream | null | undefined) => {
  if (!stream) return;
  stopStreamTracks(stream);
};

export const createHighQualityMediaRecorder = (stream: MediaStream) => {
  const mimeType = pickAudioRecordingMimeType();
  const options: MediaRecorderOptions = {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: AUDIO_RECORDING_BITRATE,
  };

  try {
    return new MediaRecorder(stream, options);
  } catch {
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  }
};

export const resolveAudioRecordingExtension = (mimeType: string) => {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
};
