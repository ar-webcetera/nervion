# Frontend (Nuxt SSR). Контекст сборки = КОРЕНЬ монорепо.
# Nuxt .output самодостаточен (свой node_modules внутри) — pnpm deploy не нужен.

FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY apps/frontend/package.json apps/frontend/
COPY packages packages
RUN pnpm install --no-frozen-lockfile --filter frontend...
COPY apps/frontend apps/frontend
RUN pnpm --filter frontend... build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /app/apps/frontend/.output ./.output
ENV NODE_ENV=production
EXPOSE 3012
CMD ["node", ".output/server/index.mjs"]
