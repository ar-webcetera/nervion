declare global {
  interface HTMLElement {
    _clickOutside?: (event: Event) => void;
  }
}

export {};
