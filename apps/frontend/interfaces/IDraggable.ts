export interface IDraggable<T> {
  added?: {
    element: T;
    newIndex: number;
    oldIndex?: number;
  };
  moved?: {
    element: T;
    newIndex: number;
    oldIndex: number;
  };
  draggedContext?: {
    element: T;
  };
  to: HTMLElement;
}
