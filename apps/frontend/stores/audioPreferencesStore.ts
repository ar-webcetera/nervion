import { defineStore } from 'pinia';
import { AudioPlaybackRate } from '~/enums/audio.enums';

const storageKey = 'audio-playback-rate';
const rates = [AudioPlaybackRate.Normal, AudioPlaybackRate.Fast, AudioPlaybackRate.Double];

export const useAudioPreferencesStore = defineStore('audioPreferences', () => {
  const playbackRate = ref(AudioPlaybackRate.Normal);
  let initialized = false;

  const initialize = () => {
    if (!import.meta.client || initialized) return;
    initialized = true;
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (rates.includes(saved)) playbackRate.value = saved;
    } catch {
      // Если хранилище недоступно, настройка работает в текущем сеансе.
    }
  };

  const nextPlaybackRate = computed(() => rates[(rates.indexOf(playbackRate.value) + 1) % rates.length]!);
  const cyclePlaybackRate = () => {
    initialize();
    playbackRate.value = nextPlaybackRate.value;
    if (!import.meta.client) return;
    try {
      localStorage.setItem(storageKey, String(playbackRate.value));
    } catch {
      // Не прерываем воспроизведение при запрете записи в хранилище.
    }
  };

  return { playbackRate, nextPlaybackRate, initialize, cyclePlaybackRate };
});
