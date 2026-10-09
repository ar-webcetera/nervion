# syntax=docker/dockerfile:1.7

# Frontend (Nuxt SSR). Контекст сборки = корень монорепо.
# Nuxt .output самодостаточен и содержит свой node_modules, поэтому pnpm deploy не нужен.

FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate
RUN pnpm config set store-dir /pnpm/store
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY apps/frontend/package.json apps/frontend/pnpm-lock.yaml apps/frontend/
COPY packages/contracts/package.json packages/contracts/pnpm-lock.yaml packages/contracts/
RUN --mount=type=cache,id=nervion-frontend-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prefer-offline --filter frontend...
COPY packages packages
COPY apps/frontend apps/frontend
# Типизация уже входит в обязательный verify:push. В Docker оставляем только
# production-сборку, чтобы vue-tsc не конкурировал с Vite за два ядра сервера.
ENV NODE_ENV=production
ENV NUXT_TYPECHECK=false
RUN --mount=type=cache,id=nervion-frontend-vite,target=/app/apps/frontend/node_modules/.cache,sharing=locked \
    pnpm --filter frontend... build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /app/apps/frontend/.output ./.output
ENV NODE_ENV=production
EXPOSE 3012
CMD ["node", ".output/server/index.mjs"]
