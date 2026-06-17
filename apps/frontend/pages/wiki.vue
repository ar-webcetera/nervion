<script setup lang="ts">
import { ROLES } from '~/types/user';
import { useProjectStore } from '~/stores/projectStore';
import { PAGE_NAMES } from '~/constants/pages.constants';
import type { JSONContent } from '@tiptap/core';
import type { BaseModal } from '#build/components';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
const { $toast } = useNuxtApp();
const isFilesOpen = ref(false);
const markdownContent = ref<JSONContent | null>(null);
const markdownFileName = ref<string>('');
const markdownKey = ref<string>('');
const isSavingMarkdown = ref(false);
const isLoadingMarkdown = ref(false);
const isEditablePageName = ref(false);
const editableName = ref<string>('');
const deletePageModal = ref<InstanceType<typeof BaseModal> | null>(null);
const copyDesc = ref<JSONContent>({});
const wikiStore = useWikiStore();
const filesStore = useFilesStore();
const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();

const getProjectName = computed(() => {
  if (!projectStore.projects?.length) return '';

  let projectIdNum: number | null = null;

  const pId = route.query?.project_id;
  if (pId && !Array.isArray(pId)) {
    const num = Number(pId);
    if (!Number.isNaN(num)) projectIdNum = num;
  }

  if (!projectIdNum && wikiStore.selectedProjectId) {
    projectIdNum = wikiStore.selectedProjectId;
  }

  if (!projectIdNum) return '';
  return projectStore.projects.find((project) => project.id === projectIdNum)?.name || '';
});

const projectId = computed(() => {
  const pId = route.query?.project_id;
  if (pId && !Array.isArray(pId)) {
    const num = Number(pId);
    if (!Number.isNaN(num)) return num;
  }
  return wikiStore.selectedProjectId || null;
});

const pageId = computed(() => {
  const pId = route.query?.page_id;
  if (!pId || Array.isArray(pId)) return null;

  const num = Number(pId);
  return Number.isNaN(num) ? null : num;
});

watch(
  () => projectId.value,
  (newProjectId) => {
    if (newProjectId && !route.query?.project_id) {
      router.push({
        query: {
          ...route.query,
          project_id: newProjectId,
        },
      });
    }
  },
  { immediate: true },
);

const fetchPage = async (pageId: number) => {
  try {
    await wikiStore.fetchPage(pageId);
    if (!wikiStore.currentPage) return;
    if (!wikiStore.currentPage?.description) {
      wikiStore.currentPage.description = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      };
    }
    copyDesc.value = wikiStore.currentPage.description;
    return wikiStore.currentPage;
  } catch (e) {
    $toast.error(getErrorMessage(e));
    return null;
  }
};

const loadProjectData = async (id: number) => {
  try {
    await wikiStore.fetchPages(id);
  } catch (e) {
    console.error(e);
  }
};

const loadData = async () => {
  if (!projectId.value) {
    wikiStore.currentPage = null;
    wikiStore.isLoading = false;
    return;
  }
  wikiStore.isLoading = true;
  await loadProjectData(projectId.value);
  if (pageId.value) {
    await Promise.all([fetchPage(pageId.value), filesStore.fetchFiles(`tracker-project-wiki/${projectId.value}/`)]);
  } else {
    wikiStore.currentPage = null;
    filesStore.files = [];
    wikiStore.isLoading = false;
  }
};

watch([projectId, pageId], () => {
  resetMarkdown();
  loadData();
});

onMounted(loadData);

const openEditPageName = () => {
  if (!wikiStore.currentPage) return;
  editableName.value = wikiStore.currentPage.name;
  isEditablePageName.value = true;
};

const closeEditPageName = () => {
  isEditablePageName.value = false;
};

const confirmEdit = async () => {
  if (!wikiStore.currentPage || !projectId.value) return;

  try {
    await wikiStore.updatePage(wikiStore.currentPage.id, { name: editableName.value });
    wikiStore.currentPage.name = editableName.value;
    await wikiStore.fetchPages(projectId.value);

    closeEditPageName();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const toggleEdit = () => {
  wikiStore.isEditable = !wikiStore.isEditable;
};

const openDeletePageModal = () => {
  if (!deletePageModal.value) return;
  deletePageModal.value.open();
};

const deletePage = async () => {
  if (!pageId.value || !projectId.value) return;

  try {
    await wikiStore.deletePage(pageId.value);

    wikiStore.currentPage = null;
    await wikiStore.fetchPages(projectId.value);

    if (deletePageModal.value) {
      deletePageModal.value.close();
    }
    await router.push({
      name: PAGE_NAMES.wiki,
      query: { project_id: projectId.value },
    });

    $toast('Страница успешно удалена');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const cancelEdit = () => {
  if (wikiStore.currentPage) {
    wikiStore.currentPage.description = copyDesc.value;
  }
  wikiStore.isEditable = false;
};

const saveDesc = async () => {
  if (!pageId.value || !wikiStore.currentPage) return;
  const description = wikiStore.currentPage.description;
  await wikiStore.updatePage(wikiStore.currentPage.id, { description });
  await fetchPage(pageId.value);
  wikiStore.isEditable = false;
};

const createNewPage = async () => {
  if (!projectId.value) return;

  try {
    const maxPriority = wikiStore.wikiTree.reduce((max, page) => {
      return page.priority > max ? page.priority : max;
    }, 0);

    const newPage = await wikiStore.createPage({
      name: 'Новая страница',
      project_id: projectId.value,
      parent_page_id: null,
      priority: maxPriority + 100,
    });

    await wikiStore.fetchPages(projectId.value);

    await router.push({
      name: PAGE_NAMES.wiki,
      query: { project_id: projectId.value, page_id: newPage.id },
    });

    $toast('Страница успешно создана');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const openMarkdown = async (key: string, name: string) => {
  isLoadingMarkdown.value = true;
  markdownContent.value = null;
  markdownFileName.value = name;
  markdownKey.value = key;
  wikiStore.currentPage = null;
  try {
    const text = await filesStore.getFileContent(key);
    const { Markdown } = await import('@tiptap/markdown');
    const { Editor } = await import('@tiptap/core');
    const { default: StarterKit } = await import('@tiptap/starter-kit');
    const { default: TableRow } = await import('@tiptap/extension-table-row');
    const { default: TableCell } = await import('@tiptap/extension-table-cell');
    const { default: TableHeader } = await import('@tiptap/extension-table-header');
    const { Table } = await import('~/utils/tiptap/table');
    const { wrapBareTextNodes } = await import('~/utils/tiptap/markdown');
    const tmpEditor = new Editor({
      extensions: [StarterKit, Markdown, Table.configure({ resizable: false }), TableRow, TableCell, TableHeader],
    });
    const manager = tmpEditor.storage.markdown?.manager as { parse: (t: string) => JSONContent } | undefined;
    if (!manager) {
      tmpEditor.destroy();
      $toast.error('Не удалось разобрать markdown');
      return;
    }
    const parsed = manager.parse(text);
    tmpEditor.destroy();
    markdownContent.value = {
      type: 'doc',
      content: wrapBareTextNodes(parsed.content ?? []),
    };
  } catch {
    $toast.error('Не удалось загрузить файл');
    markdownFileName.value = '';
    markdownKey.value = '';
  } finally {
    isLoadingMarkdown.value = false;
  }
};

const resetMarkdown = () => {
  markdownContent.value = null;
  markdownFileName.value = '';
  markdownKey.value = '';
};

const closeMarkdown = async () => {
  resetMarkdown();
  if (projectId.value) {
    const currentPageId = pageId.value ?? wikiStore.currentPage?.id ?? null;
    await router.push({
      name: PAGE_NAMES.wiki,
      query: currentPageId ? { project_id: projectId.value, page_id: currentPageId } : { project_id: projectId.value },
    });

    if (currentPageId) {
      await loadData();
    }
  }
};

const saveMarkdown = async () => {
  if (!markdownContent.value || !markdownKey.value) return;
  const { Markdown } = await import('@tiptap/markdown');
  const { Editor } = await import('@tiptap/core');
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  const { default: TableRow } = await import('@tiptap/extension-table-row');
  const { default: TableCell } = await import('@tiptap/extension-table-cell');
  const { default: TableHeader } = await import('@tiptap/extension-table-header');
  const { Table } = await import('~/utils/tiptap/table');
  isSavingMarkdown.value = true;
  try {
    const tmpEditor = new Editor({
      extensions: [StarterKit, Markdown, Table.configure({ resizable: false }), TableRow, TableCell, TableHeader],
      content: markdownContent.value,
    });
    const manager = tmpEditor.storage.markdown?.manager as { serialize: (doc: JSONContent) => string } | undefined;
    if (!manager) {
      tmpEditor.destroy();
      $toast.error('Не удалось сериализовать markdown');
      return;
    }
    const text = manager.serialize(tmpEditor.state.doc.toJSON() as JSONContent);
    tmpEditor.destroy();
    await filesStore.saveFileContent(markdownKey.value, text);
    $toast('Файл сохранён');
  } catch {
    $toast.error('Ошибка при сохранении файла');
  } finally {
    isSavingMarkdown.value = false;
  }
};

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin, ROLES.employee],
});
</script>

<template>
  <div class="wiki-layout">
    <WikiSidebar />
    <div class="wiki-layout__content">
      <div class="project-wiki">
        <div class="project-wiki__header">
          <p>Wiki</p>
          <div class="project-wiki__header-actions">
            <button
              :disabled="!projectId"
              :class="[
                'project-wiki__header-btn',
                'project-wiki__header-btn_ghost',
                { 'project-wiki__header-btn_ghost-active': isFilesOpen },
              ]"
              @click.stop="isFilesOpen = !isFilesOpen"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path
                  d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h1.879a1.5 1.5 0 0 1 1.06.44L7 4.5h5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 12.5H3A1.5 1.5 0 0 1 1.5 11V4.5z"
                  stroke="currentColor"
                  stroke-width="1.3"
                />
              </svg>
              <span>Файлы</span>
            </button>
            <button
              class="project-wiki__header-btn project-wiki__header-btn_primary"
              :disabled="!projectId"
              @click.stop="createNewPage"
            >
              <IconsIconPlus />
              <span>Новая страница</span>
            </button>
          </div>
        </div>
        <div v-if="!projectId" class="project-wiki__placeholder-content">
          <h1>База знаний</h1>
          <p>Выберите проект в меню слева, чтобы начать работу.</p>
        </div>
        <!-- Загрузка MD-файла -->
        <div v-else-if="isLoadingMarkdown" class="project-wiki__page">
          <div class="project-wiki__page-body">
            <div class="project-wiki__skeleton">
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--wide" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--medium" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--short" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--wide" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--medium" />
            </div>
          </div>
        </div>
        <!-- MD-файл из файлового менеджера -->
        <div v-else-if="markdownContent" class="project-wiki__page">
          <div class="project-wiki__page-top">
            <div class="project-wiki__page-title">
              <span>{{ markdownFileName }}</span>
            </div>
            <div class="project-wiki__header-actions" style="margin-left: auto">
              <button class="project-wiki__header-btn project-wiki__header-btn_ghost" @click.stop="closeMarkdown">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M11 4L4 11M4 4l7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </svg>
                <span>Закрыть</span>
              </button>
              <button
                class="project-wiki__header-btn project-wiki__header-btn_primary"
                :disabled="isSavingMarkdown"
                @click.stop="saveMarkdown"
              >
                <span>{{ isSavingMarkdown ? 'Сохранение...' : 'Сохранить' }}</span>
              </button>
            </div>
          </div>
          <div class="project-wiki__page-body">
            <EditorTiptap :key="markdownFileName" v-model="markdownContent" :is-editable="true" :value="markdownContent" />
          </div>
        </div>
        <div v-else-if="!pageId" class="project-wiki__placeholder-content">
          <h1>База знаний проекта {{ getProjectName }}</h1>
          <p>Выберите страницу в меню слева, чтобы начать работу, или создайте новую.</p>
        </div>
        <div v-else-if="pageId && wikiStore.isLoading" class="project-wiki__page">
          <div class="project-wiki__page-body">
            <div class="project-wiki__skeleton">
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--wide" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--medium" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--short" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--wide" />
              <div class="project-wiki__skeleton-line project-wiki__skeleton-line--medium" />
            </div>
          </div>
        </div>
        <div v-else-if="wikiStore.currentPage && pageId" class="project-wiki__page">
          <div class="project-wiki__page-top">
            <div class="project-wiki__page-title">
              <template v-if="!isEditablePageName">
                <span @dblclick="openEditPageName">{{ wikiStore.currentPage.name }}</span>
              </template>
              <template v-else>
                <div class="project-wiki__page-name">
                  <input
                    v-model="editableName"
                    type="text"
                    placeholder="Введите название страницы"
                    @keyup.enter.stop="confirmEdit"
                  />
                  <div>
                    <span @click.stop="confirmEdit">
                      <IconsIconConfirm />
                    </span>
                    <span @click.stop="closeEditPageName">
                      <IconsIconClose />
                    </span>
                  </div>
                </div>
              </template>
            </div>
            <div class="project-wiki__page-mode">
              <span>Режим редактирования</span>
              <WikiToggle :toggle="wikiStore.isEditable" @toggle="toggleEdit" />
            </div>
            <template v-if="wikiStore.isEditable">
              <button class="project-wiki__header-btn project-wiki__header-btn_ghost" @click.stop="cancelEdit">
                Выйти без сохранения
              </button>
              <button class="project-wiki__header-btn project-wiki__header-btn_primary" @click.stop="saveDesc">
                Сохранить
              </button>
            </template>
            <template v-else>
              <div class="project-wiki__page-delete" @click.stop="openDeletePageModal">Удалить страницу</div>
            </template>
          </div>
          <div class="project-wiki__page-body">
            <EditorTiptap
              v-if="wikiStore.currentPage"
              :key="String(wikiStore.currentPage.id)"
              v-model="wikiStore.currentPage.description"
              :is-editable="wikiStore.isEditable"
              :value="wikiStore.currentPage.description"
            />
          </div>
        </div>
        <teleport to="#teleports">
          <BaseModal ref="deletePageModal">
            <div class="delete-page-modal">
              <div class="delete-page-modal__header">
                <h2>Вы уверены что хотите удалить страницу?</h2>
              </div>
              <button class="btn" @click="deletePage">Удалить</button>
            </div>
          </BaseModal>
        </teleport>
      </div>
      <Transition name="slide-panel">
        <WikiFileExplorer
          v-if="isFilesOpen && projectId"
          :project-id="projectId"
          @close="isFilesOpen = false"
          @open-markdown="openMarkdown"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped lang="scss">
.delete-page-modal {
  padding: 24px;
  @include flex(cn);
  gap: 24px;

  &__header {
    h2 {
      @extend %h1;
    }
  }
}

.wiki-layout {
  height: 100%;
  width: 100%;
  @include flex(rn);
  gap: 4px;
  overflow: hidden;

  &__content {
    width: 100%;
    min-width: 0;
    height: 100dvh;
    background: var(--light-text-backgroung-primary-5);
    @include flex(rn);
    gap: 12px;
    padding: 16px;
    overflow: hidden;
  }
}

.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.slide-panel-enter-from,
.slide-panel-leave-to {
  width: 0 !important;
  min-width: 0 !important;
  opacity: 0;
  padding: 0;
}

.project-wiki {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &__placeholder-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    gap: 16px;

    h1 {
      @extend %h1;
      color: var(--text-primary);
    }

    p {
      @extend %text-m-regular;
      max-width: 400px;
    }
  }

  &__placeholder-icon {
    width: 64px;
    height: 64px;
    color: var(--primary-color);
  }

  &__breadcrumbs {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__page {
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
  }

  &__page-body {
    @extend %p14-medium;
    overflow: auto;
    padding-top: 16px;
    padding-right: 8px;
    height: 100%;
    padding-bottom: 100px;
    &-wrapper {
      overflow: auto;
    }
  }

&__header {
    @include flex(rn, a-center);
    margin-bottom: 16px;
    @extend %display-xs-medium;
    gap: 12px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);

    p {
      flex: 1;
    }
  }

  &__header-actions {
    @include flex(rn, a-center);
    gap: 8px;
    flex-shrink: 0;
  }

  &__header-btn {
    @extend %text-s-medium;
    color: var(--white-100);
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    @include flex(rn, a-center);
    gap: 6px;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
    flex-shrink: 0;

    &:disabled {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
    }

    svg {
      stroke: currentColor;
      flex-shrink: 0;
      width: 15px;
      height: 15px;
    }

    &_primary {
      background: var(--primary-dark);

      &:hover {
        background: var(--primary);
      }
    }

    &_ghost {
      background: transparent;
      border: 1px solid var(--light-text-backgroung-primary-25);
      color: var(--light-text-backgroung-primary-50);

      &:hover {
        border-color: var(--light-text-backgroung-primary-50);
        color: var(--white-100);
      }

      &-active {
        border-color: var(--primary);
        color: var(--primary-100);
        background: var(--light-text-backgroung-primary-5);

        &:hover {
          background: var(--light-text-backgroung-primary-10);
        }
      }
    }
  }

  &__add-page {
    border-radius: 1000px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.5s ease;
    transform: rotate(0deg);
    border: 1px solid var(--light-text-backgroung-primary-5);
    cursor: pointer;
  }

  &__title {
    @extend %h1;
  }

  &__content {
    width: 100%;
    margin-top: 16px;
    height: 100%;
    @include flex(cn);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    margin-bottom: 4px;
  }

  &__page {
    border-radius: 8px;
  }

  &__page-top {
    @include flex(rn, a-center);
    gap: 24px;
    flex-shrink: 0;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }

  &__page-title {
    @extend %p16-bold;
    color: var(--white-100);

    & > span {
      user-select: none;
    }
  }

  &__page-name {
    @include flex(rn, a-center);
    gap: 8px;

    & > div {
      @include flex(rn, a-center);
      gap: 4px;
      cursor: pointer;
    }

    span {
      @include flex(center);
      width: 16px;
      height: 16px;
      border-radius: 4px;

      &:first-child {
        background-color: var(--green);
      }

      &:last-child {
        background-color: var(--secondary);
      }
    }

    svg {
      fill: var(--white-100);
      width: 12px;
      height: 12px;
    }

    input {
      @extend %p16-bold;
      color: var(--white-100);
      padding: 0 4px;
      background: var(--white-10);
    }
  }

  &__page-mode {
    margin-left: auto;
    @include flex(rn, a-center);
    gap: 10px;
    height: 40px;
    width: fit-content;
    padding: 10px 20px;
    border-radius: 1000px;
    border: 1px solid var(--light-text-backgroung-primary-5);
    @extend %p14-bold;
    white-space: nowrap;
  }

  &__skeleton {
    @include flex(cn);
    gap: 12px;
    padding-top: 8px;

    &-line {
      height: 16px;
      border-radius: 6px;
      background: var(--light-text-backgroung-primary-10);
      animation: skeleton-pulse 1.5s ease-in-out infinite;

      &--wide {
        width: 90%;
      }
      &--medium {
        width: 65%;
      }
      &--short {
        width: 40%;
      }
    }
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  &__page-delete {
    @include flex(center);
    white-space: nowrap;
    cursor: pointer;
  }
}
</style>
