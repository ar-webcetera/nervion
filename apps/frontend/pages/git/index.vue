<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ROLES } from '~/types/user';
import { useGitStore } from '~/stores/gitStore';
import type { GitCommit, GitRepo, GitTreeEntry } from '~/types/git';
import type { SelectOption } from '~/types/select';
import { getErrorMessage } from '~/utils/error';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

interface TreeRow {
  entry: GitTreeEntry;
  depth: number;
  expanded: boolean;
}

const { $toast } = useNuxtApp();
const route = useRoute();
const router = useRouter();
const gitStore = useGitStore();

const { repos, branches, commits, tree, currentRepoId: repoId, currentBranch: branch, detail, detailLoading } =
  storeToRefs(gitStore);

const qNum = (v: unknown): number | undefined => (typeof v === 'string' && v ? Number(v) : undefined);
const qStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// Запоминаем выбранные репо/ветку между переходами (cookie доступен и на SSR —
// при заходе на /git без параметров восстанавливаем последний выбор без мелькания).
const lastRepo = useCookie<number | null>('git_repo', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
const lastBranch = useCookie<string | null>('git_branch', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });

// URL — источник истины состояния раздела (?repo&branch&tab&commit&file).
const setQuery = (patch: Record<string, string | number | undefined>, replace = false) => {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) {
    if (v != null && v !== '') next[k] = String(v);
  }
  const loc = { query: next };
  void (replace ? router.replace(loc) : router.push(loc)).catch(() => {});
};

// Первичная загрузка (SSR) по параметрам из URL — данные кладутся в Pinia-стор.
// ВАЖНО: вернуть truthy, иначе useAsyncData считает payload пустым и
// перезапрашивает на клиенте (прогрузка после маунта вместо SSR-гидрации).
await useAsyncData('git-initial', async () => {
  await gitStore.loadInitial(
    qNum(route.query.repo) ?? lastRepo.value ?? undefined,
    qStr(route.query.branch) ?? lastBranch.value ?? undefined,
    qStr(route.query.commit),
    qStr(route.query.file),
  );
  return true;
});

const treeRows = ref<TreeRow[]>([]);
const connectModal = ref();

// Подсветка активного коммита/файла — из URL.
const activeKey = computed(() => {
  if (route.query.commit) return `c:${String(route.query.commit)}`;
  if (route.query.file) return `f:${String(route.query.file)}`;
  return '';
});

// Пропсы для DiffView (картинки) — считаем в скрипте, чтобы не сужать detail в шаблоне.
const diffRepoId = computed(() => repoId.value ?? 0);
const diffHeadRef = computed(() => (detail.value?.kind === 'diff' ? detail.value.commit.hash : ''));

// Вкладка живёт в URL (?tab=files).
const mode = computed<'commits' | 'files'>({
  get: () => (route.query.tab === 'files' ? 'files' : 'commits'),
  set: (v) => setQuery({ tab: v === 'files' ? 'files' : undefined }),
});

const repoOptions = computed<SelectOption[]>(() => repos.value.map((r) => ({ label: r.name, value: r.id })));
const branchOptions = computed<SelectOption[]>(() => branches.value.map((b) => ({ label: b.name, value: b.name })));

// Строки дерева строим из корневого store.tree.
watch(
  tree,
  (entries) => {
    treeRows.value = entries.map((entry) => ({ entry, depth: 0, expanded: false }));
  },
  { immediate: true },
);

// Запоминаем текущий выбор репо/ветки в cookie (для восстановления при возврате на /git).
watch([repoId, branch], ([r, br]) => {
  if (r != null) lastRepo.value = r;
  if (br) lastBranch.value = br;
});

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

const onRepoChange = (v: string | number | (string | number)[] | null) =>
  setQuery({ repo: Number(v), branch: undefined, commit: undefined, file: undefined });

const onBranchChange = (v: string | number | (string | number)[] | null) =>
  setQuery({ branch: String(v ?? ''), commit: undefined, file: undefined });

const openCommit = (c: GitCommit) => setQuery({ commit: c.hash, file: undefined });
const openFile = (entry: GitTreeEntry) => setQuery({ file: entry.path, commit: undefined });

const toggleFolder = async (index: number) => {
  const row = treeRows.value[index];
  if (repoId.value == null || !row) return;
  if (row.expanded) {
    let count = 0;
    for (let i = index + 1; i < treeRows.value.length; i++) {
      if (treeRows.value[i].depth > row.depth) count++;
      else break;
    }
    treeRows.value.splice(index + 1, count);
    row.expanded = false;
    return;
  }
  try {
    const children = await gitStore.fetchTree(repoId.value, branch.value, row.entry.path);
    const childRows: TreeRow[] = children.map((entry) => ({ entry, depth: row.depth + 1, expanded: false }));
    treeRows.value.splice(index + 1, 0, ...childRows);
    row.expanded = true;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const onNodeClick = (row: TreeRow, index: number) => {
  if (row.entry.type === 'tree') void toggleFolder(index);
  else openFile(row.entry);
};

// Деталь (дифф коммита / файл) грузим по параметрам URL.
// Реакция на изменения URL (клики, назад/вперёд) — на клиенте.
// Деталь по URL грузит стор (loadDetail), он же пропускает повтор, если она
// уже загружена (в т.ч. из SSR), — поэтому при перезагрузке нет мелькания.
const reconcile = async () => {
  const repoQ = qNum(route.query.repo);
  const branchQ = qStr(route.query.branch);
  if (repoQ != null && repoQ !== repoId.value) {
    try {
      await gitStore.selectRepo(repoQ);
    } catch (e) {
      $toast.error(getErrorMessage(e));
      return;
    }
    if (!branchQ && branch.value) {
      setQuery({ branch: branch.value }, true);
      return;
    }
  } else if (branchQ && branchQ !== branch.value) {
    try {
      await gitStore.selectBranch(branchQ);
    } catch (e) {
      $toast.error(getErrorMessage(e));
      return;
    }
  }
  try {
    await gitStore.loadDetail(qStr(route.query.commit), qStr(route.query.file));
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

onMounted(() => {
  watch(() => route.query, () => void reconcile(), { deep: true, immediate: true });
});

const onRepoCreated = async (repo: GitRepo) => {
  try {
    await gitStore.refreshAndSelect(repo.id);
  } catch (e) {
    $toast.error(getErrorMessage(e));
    return;
  }
  setQuery({ repo: repo.id, branch: branch.value || undefined, commit: undefined, file: undefined });
};

// --- авто-обновление раздела при новых коммитах (polling каждые 10с) ---
const POLL_MS = 10000;
const knownSha = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const currentSha = () => branches.value.find((b) => b.name === branch.value)?.sha ?? null;

async function checkGitUpdates() {
  if (!repoId.value || !branch.value) return;
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    await gitStore.fetchBranches(repoId.value);
    const cur = currentSha();
    if (knownSha.value && cur && cur !== knownSha.value) {
      await gitStore.loadInitial(repoId.value, branch.value, qStr(route.query.commit), qStr(route.query.file));
    }
    if (cur) knownSha.value = cur;
  } catch {
    /* тихо игнорируем сетевые сбои опроса */
  }
}

watch([repoId, branch], () => { knownSha.value = currentSha(); });

onMounted(() => {
  knownSha.value = currentSha();
  pollTimer = setInterval(checkGitUpdates, POLL_MS);
});
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<template>
  <div class="git">
    <div class="git__topbar">
      <div class="git__topbar-main">
        <h1 class="git__title">Git</h1>
        <BaseSelect
          v-if="repoOptions.length"
          class="git__select"
          :options="repoOptions"
          :model-value="repoId"
          placeholder="Репозиторий"
          arrow
          @update:model-value="onRepoChange"
        />
        <BaseSelect
          v-if="branchOptions.length"
          class="git__select"
          :options="branchOptions"
          :model-value="branch"
          placeholder="Ветка"
          arrow
          @update:model-value="onBranchChange"
        />
      </div>
      <button class="git__connect" @click="connectModal?.open()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        Подключить
      </button>
    </div>

    <hr class="git__divider" />

    <div class="git__body">
      <div class="git__list">
        <div class="git__tabs">
          <button
            :class="['git__tab', { git__tab_active: mode === 'commits' }]"
            @click="mode = 'commits'"
          >
            Коммиты
          </button>
          <button
            :class="['git__tab', { git__tab_active: mode === 'files' }]"
            @click="mode = 'files'"
          >
            Файлы
          </button>
        </div>

        <div class="git__list-scroll">
          <div v-if="!repoOptions.length" class="git__list-empty">
            Нет подключённых репозиториев
          </div>
          <template v-if="mode === 'commits'">
            <button
              v-for="c in commits"
              :key="c.hash"
              :class="['git__commit', { git__commit_active: activeKey === `c:${c.hash}` }]"
              @click="openCommit(c)"
            >
              <span class="git__commit-subject">{{ c.subject }}</span>
              <span class="git__commit-meta">
                <span class="git__hash">{{ c.shortHash }}</span>
                {{ c.authorName }} · {{ formatDate(c.date) }}
              </span>
            </button>
          </template>

          <template v-else>
            <button
              v-for="(row, i) in treeRows"
              :key="row.entry.path"
              :class="['git__node', { git__node_active: activeKey === `f:${row.entry.path}`, git__node_dir: row.entry.type === 'tree' }]"
              :style="{ paddingLeft: 6 + row.depth * 14 + 'px' }"
              @click="onNodeClick(row, i)"
            >
              <span class="git__node-toggle">
                <svg
                  v-if="row.entry.type === 'tree'"
                  class="git__chevron"
                  :class="{ git__chevron_open: row.expanded }"
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span class="git__node-name">{{ row.entry.name }}</span>
            </button>
          </template>
        </div>
      </div>

      <div class="git__detail">
        <div v-if="detailLoading" class="git__detail-state">Загрузка…</div>
        <template v-else-if="detail">
          <div class="git__detail-head">
            <template v-if="detail.kind === 'diff'">
              <span class="git__detail-title">{{ detail.commit.subject }}</span>
              <span class="git__detail-sub">
                <span class="git__hash">{{ detail.commit.shortHash }}</span>
                {{ detail.commit.authorName }} · {{ formatDate(detail.commit.date) }}
              </span>
            </template>
            <template v-else>
              <span class="git__detail-title">{{ detail.entry.path }}</span>
            </template>
          </div>
          <div class="git__detail-scroll">
            <GitDiffView
              v-if="detail.kind === 'diff'"
              :diff="detail.data"
              :repoId="diffRepoId"
              :headRef="diffHeadRef"
            />
            <GitFileView v-else :file="detail.data" :repo-id="repoId" :git-ref="branch" />
          </div>
        </template>
        <div v-else class="git__detail-state">
          {{ mode === 'commits' ? 'Выберите коммит, чтобы увидеть изменения' : 'Выберите файл, чтобы открыть содержимое' }}
        </div>
      </div>
    </div>

    <GitConnectRepoModal ref="connectModal" @created="onRepoCreated" />
  </div>
</template>

<style scoped lang="scss">
.git {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  @include flex(cn);
  gap: 16px;

  &__topbar {
    @include flex(rn, between, a-center);
    gap: 16px;
    @media (max-width: $screen-tablet) {
      flex-direction: column;
      align-items: stretch;
    }
  }

  &__topbar-main {
    @include flex(rn, a-center);
    gap: 12px;
    min-width: 0;
  }

  &__title {
    margin: 0;
    margin-right: 4px;
    @extend %display-xs-medium;
  }

  &__select {
    flex-shrink: 0;
  }

  &__connect {
    @include flex(rn, a-center, j-center);
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    white-space: nowrap;
    @extend %text-s-medium;

    &:hover {
      border-color: var(--primary-50);
    }

    &_solid {
      background: var(--primary);
      border-color: var(--primary);
      &:hover {
        background: var(--primary-hover);
        border-color: var(--primary-hover);
      }
    }
  }

  &__divider {
    width: 100%;
    height: 1px;
    border: none;
    background: var(--light-text-backgroung-primary-10);
    margin: 0;
  }

  &__empty {
    @include flex(cn, center);
    flex: 1;
    gap: 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 16px;
    overflow: hidden;
    @media (max-width: $screen-tablet) {
      grid-template-columns: 1fr;
    }
  }

  &__list {
    @include flex(cn);
    min-height: 0;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    overflow: hidden;
    background: var(--dark-text-background-primary);
  }

  &__tabs {
    @include flex(rn);
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__tab {
    flex: 1;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @extend %text-s-medium;

    &:hover:not(.git__tab_active) {
      background: var(--light-text-backgroung-primary-5);
    }
    &_active {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0;
  }

  &__commit {
    @include flex(cn);
    justify-content: flex-start;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 12px;
    border: none;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    background: transparent;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
    &_active {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__commit-subject {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  &__commit-meta {
    @extend %p12-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__hash {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    color: var(--primary-75);
  }

  &__node {
    @include flex(rn, a-center);
    justify-content: flex-start;
    gap: 4px;
    width: 100%;
    padding-top: 7px;
    padding-bottom: 7px;
    padding-right: 12px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
    &_active {
      background: var(--light-text-backgroung-primary-10);
    }
    &_dir {
      @extend %text-s-medium;
    }
  }

  &__node-toggle {
    @include flex(center);
    flex: 0 0 auto;
    width: 12px;
    height: 14px;
    color: var(--light-text-backgroung-primary-50);
  }

  &__chevron {
    transition: transform 0.12s ease;

    &_open {
      transform: rotate(90deg);
    }
  }

  &__node-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__detail {
    @include flex(cn);
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    overflow: hidden;
    background: var(--light-text-backgroung-primary-5);
  }

  &__detail-state {
    @include flex(center);
    flex: 1;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__detail-head {
    @include flex(cn);
    gap: 4px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__detail-title {
    @extend %text-s-medium;
    word-break: break-all;
  }

  &__detail-sub {
    @extend %p12-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__detail-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  &__list-empty {
    padding: 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
}
</style>
