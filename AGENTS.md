# AGENTS

Обязательный роутер правил для AI-агентов и контрибьюторов этого репозитория.

Монорепо: `apps/backend` (NestJS + TypeORM), `apps/frontend` (Nuxt 3 / Vue),
`packages/contracts` (общие контракты backend/frontend). Менеджер пакетов —
pnpm, оркестрация — turbo.

Перед работой откройте документы, относящиеся к задаче:

- Любые коммиты и изменение Git-истории —
  [`docs/agents/git-and-commits.md`](docs/agents/git-and-commits.md).
- Изменение кода, конфигурации, README или другой документации —
  [`docs/agents/documentation.md`](docs/agents/documentation.md).
- Работа с секретами, env-файлами и локальными артефактами —
  [`docs/agents/repository-safety.md`](docs/agents/repository-safety.md).
- Push, публикация и эксплуатационные действия —
  [`docs/agents/deployment.md`](docs/agents/deployment.md).
- Backend API, общие контракты и типы —
  [`docs/agents/architecture-and-types.md`](docs/agents/architecture-and-types.md).
- Frontend, Vue/Nuxt, вёрстка и стили —
  [`docs/agents/frontend.md`](docs/agents/frontend.md).

Все подходящие к задаче документы обязательны одновременно. Более локальный
`AGENTS.md`, если он появится внутри каталога, дополняет эти правила для своей
области.
