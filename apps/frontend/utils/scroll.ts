/**
 * Вычисляет позицию скролла для центрирования элемента
 */
export const getTargetTopScroll = (target: HTMLElement, scroller: HTMLElement): number => {
  const sRect = scroller.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  const paddingTop = parseFloat(getComputedStyle(scroller).paddingTop || '0') || 0;

  return Math.max(0, scroller.scrollTop + (tRect.top - sRect.top) - paddingTop);
};

/**
 * Плавный скролл к элементу
 */
export const smoothScrollToTarget = (scroller: HTMLElement, target: HTMLElement, duration = 0): void => {
  const startTop = scroller.scrollTop;
  let targetTop = getTargetTopScroll(target, scroller);
  const startTime = performance.now();

  const frame = (now: number) => {
    const measured = getTargetTopScroll(target, scroller);
    if (Math.abs(measured - targetTop) > 1) targetTop = measured;

    const t = Math.min(1, (now - startTime) / duration);
    scroller.scrollTop = startTop + (targetTop - startTop);

    if (t < 1) requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};
