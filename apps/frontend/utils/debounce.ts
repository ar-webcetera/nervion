export const debounce = (fn: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return function (this: any, ...args: any[]) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(context, args), wait);
  };
};
