export const debounce = <Args extends object[]>(fn: (...args: Args) => void, wait: number): ((...args: Args) => void) => {
  let timeout: ReturnType<typeof setTimeout>;

  return (...args: Args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
};
