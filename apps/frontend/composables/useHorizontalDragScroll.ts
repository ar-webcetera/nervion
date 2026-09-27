const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"], [draggable="true"], [data-no-board-pan]';

export const useHorizontalDragScroll = () => {
  const isDragging = ref(false);
  let activeElement: HTMLElement | null = null;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;

  const reset = () => {
    isDragging.value = false;
    activeElement = null;
    pointerId = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;

    const target = event.target;
    if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return;

    const element = event.currentTarget;
    if (!(element instanceof HTMLElement) || element.scrollWidth <= element.clientWidth) return;

    activeElement = element;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = element.scrollLeft;
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!activeElement || pointerId !== event.pointerId) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!isDragging.value) {
      if (Math.abs(deltaX) < 4 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      isDragging.value = true;
    }

    event.preventDefault();
    activeElement.scrollLeft = startScrollLeft - deltaX;
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!activeElement || pointerId !== event.pointerId) return;

    if (activeElement.hasPointerCapture(event.pointerId)) {
      activeElement.releasePointerCapture(event.pointerId);
    }
    reset();
  };

  return {
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
  };
};
