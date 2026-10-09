# syntax=docker/dockerfile:1.7

# Backend (NestJS) + mediasoup. Контекст сборки = корень монорепо.

# ---------- build ----------
FROM node:22-bookworm AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate
RUN pnpm config set store-dir /pnpm/store
# нативная сборка mediasoup-воркера (C++)
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential && rm -rf /var/lib/apt/lists/*

# Только манифесты до установки. Изменение исходников не сбрасывает слой зависимостей.
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY apps/backend/package.json apps/backend/pnpm-lock.yaml apps/backend/
COPY packages/contracts/package.json packages/contracts/pnpm-lock.yaml packages/contracts/
# Версия mediasoup и соответствующий worker должны оставаться синхронизированы:
# несовместимые версии используют разные FlatBuffers-схемы RTP mapping.
RUN --mount=type=cache,id=nervion-backend-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prefer-offline --filter backend...

# Production-зависимости зависят только от lockfile и package.json. Тяжёлый
# pnpm deploy не повторяется при обычном изменении исходников.
FROM dependencies AS production-dependencies
RUN --mount=type=cache,id=nervion-backend-pnpm,target=/pnpm/store,sharing=locked \
    pnpm --filter backend deploy --prod /out

FROM dependencies AS build

# mediasoup-воркер исключён из автосборки: libwebrtc компилируется долго.
# в рантайме отдаём через MEDIASOUP_WORKER_BIN. Источник бинаря:
#  1) вендорный prebuilt apps/backend/vendor/mediasoup-worker (вне git, кладёт оператор) — если есть;
#  2) иначе качаем prebuilt с GitHub (release-assets из РФ нестабилен — отсюда вендор как обход).
ARG MEDIASOUP_WORKER_SHA256=6ce2288297858ecd0d7eafbebbe402e6824d4b0325b4c8d51cd14fb2ff7ac296
COPY apps/backend/vendor/ /vendor/
RUN if [ -f /vendor/mediasoup-worker ]; then \
      echo ">>> mediasoup: используем вендорный prebuilt"; \
      cp /vendor/mediasoup-worker /mediasoup-worker; \
    else \
      echo ">>> mediasoup: вендорного нет, качаем prebuilt с GitHub"; \
      cd apps/backend/node_modules/mediasoup \
        && MEDIASOUP_FORCE_WORKER_PREBUILT_DOWNLOAD=true node npm-scripts.mjs postinstall \
        && cp worker/out/Release/mediasoup-worker /mediasoup-worker; \
    fi \
 && echo "${MEDIASOUP_WORKER_SHA256}  /mediasoup-worker" | sha256sum --check --strict \
 && chmod +x /mediasoup-worker && test -x /mediasoup-worker && ls -lh /mediasoup-worker

# исходники + сборка
COPY packages packages
COPY apps/backend apps/backend
RUN pnpm --filter @tracker/contracts build \
 && pnpm --filter backend build:docker

# deploy выполняется до копирования исходников. Добавляем в его результат только
# собранный runtime-код общего workspace-пакета.
FROM production-dependencies AS release-dependencies
COPY --from=build /app/packages/contracts/dist /contracts-dist
RUN test -L /out/node_modules/@tracker/contracts \
 && mkdir -p /out/node_modules/@tracker/contracts/dist \
 && cp -a /contracts-dist/. /out/node_modules/@tracker/contracts/dist/

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# git нужен для self-hosted раздела, ffmpeg для обработки медиа, ca-certificates для HTTPS.
# Транскрипция работает через внешний API, локальный whisper/PyTorch не нужен.
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=release-dependencies /out/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./dist
# prebuilt mediasoup-воркер (вне node_modules, чтобы не потерялся при pnpm deploy)
COPY --from=build /mediasoup-worker /usr/local/bin/mediasoup-worker
RUN chmod +x /usr/local/bin/mediasoup-worker
ENV NODE_ENV=production
ENV MEDIASOUP_WORKER_BIN=/usr/local/bin/mediasoup-worker
EXPOSE 3026
CMD ["node", "dist/main.js"]
