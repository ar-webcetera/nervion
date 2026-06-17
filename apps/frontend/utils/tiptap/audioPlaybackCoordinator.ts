export type AudioPlaybackController = {
  element: HTMLAudioElement;
  reset: () => void;
};

let activeAudioController: AudioPlaybackController | null = null;

export const activateAudioPlayback = (controller: AudioPlaybackController) => {
  if (activeAudioController && activeAudioController.element !== controller.element) {
    activeAudioController.element.pause();
    activeAudioController.element.currentTime = 0;
    activeAudioController.reset();
  }

  activeAudioController = controller;
};

export const clearActiveAudioPlayback = (element: HTMLAudioElement | null) => {
  if (!element) return;
  if (activeAudioController?.element === element) {
    activeAudioController = null;
  }
};
