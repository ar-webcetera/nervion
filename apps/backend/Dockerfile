# Backend (NestJS) + mediasoup. Контекст сборки = КОРЕНЬ монорепо.
# Собирать в CI / локально → пушить в реестр. НЕ на сервере (network-SSD 54 МБ/с медленный).

# ---------- build ----------
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate
# нативная сборка mediasoup-воркера (C++)
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential && rm -rf /var/lib/apt/lists/*

# манифесты сначала — кэш слоёв install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY apps/backend/package.json apps/backend/
COPY packages packages
# NB: --no-frozen-lockfile — в master pnpm-lock.yaml рассинхронизирован с packages/contracts
# (нужно pnpm install + коммит lock в репо; для CI/прода вернуть --frozen-lockfile)
RUN pnpm install --no-frozen-lockfile --filter backend...

# mediasoup-воркер исключён из автосборки (neverBuiltDependencies — libwebrtc компилить долго),
# в рантайме отдаём через MEDIASOUP_WORKER_BIN. Источник бинаря:
#  1) вендорный prebuilt apps/backend/vendor/mediasoup-worker (вне git, кладёт оператор) — если есть;
#  2) иначе качаем prebuilt с GitHub (release-assets из РФ нестабилен — отсюда вендор как обход).
COPY apps/backend/vendor/ /vendor/
RUN if [ -f /vendor/mediasoup-worker ]; then \
      echo ">>> mediasoup: используем вендорный prebuilt"; \
      cp /vendor/mediasoup-worker /mediasoup-worker; \
    else \
      echo ">>> mediasoup: вендорного нет, качаем prebuilt с GitHub"; \
      cd "$(find node_modules/.pnpm -maxdepth 3 -type d -path '*mediasoup@*/node_modules/mediasoup' | head -1)" \
        && MEDIASOUP_FORCE_WORKER_PREBUILT_DOWNLOAD=true node npm-scripts.mjs postinstall \
        && cp worker/out/Release/mediasoup-worker /mediasoup-worker; \
    fi \
 && chmod +x /mediasoup-worker && test -x /mediasoup-worker && ls -lh /mediasoup-worker

# исходники + сборка
COPY apps/backend apps/backend
RUN pnpm --filter backend... build
# изолированный prod-набор зависимостей (вместе со скомпилированным mediasoup-воркером)
RUN pnpm --filter backend deploy --prod /out

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# git — для self-hosted раздела; ffmpeg — препроцессинг аудио/медиа; ca-certificates — S3/HTTPS/API
# (транскрипция через внешний API, ключ в .env — локальный whisper/PyTorch НЕ нужен, образ лёгкий)
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./dist
# prebuilt mediasoup-воркер (вне node_modules, чтобы не потерялся при pnpm deploy)
COPY --from=build /mediasoup-worker /usr/local/bin/mediasoup-worker
RUN chmod +x /usr/local/bin/mediasoup-worker
ENV NODE_ENV=production
ENV MEDIASOUP_WORKER_BIN=/usr/local/bin/mediasoup-worker
EXPOSE 3026
CMD ["node", "dist/main.js"]
