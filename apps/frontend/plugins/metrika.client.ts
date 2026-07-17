interface YmFn {
  (...args: unknown[]): void;
  a?: unknown[];
  l?: number;
}

export default defineNuxtPlugin(() => {
  const id = useRuntimeConfig().public.metrikaId as string | undefined;
  if (!id) return;
  const w = window as unknown as { ym?: YmFn };
  if (!w.ym) {
    const stub: YmFn = (...args: unknown[]) => {
      (stub.a = stub.a || []).push(args);
    };
    stub.l = Number(new Date());
    w.ym = stub;
  }
  const sc = document.createElement("script");
  sc.async = true;
  sc.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.appendChild(sc);
  w.ym(Number(id), "init", {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });
});
