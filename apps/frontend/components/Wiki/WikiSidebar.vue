<template>
  <div class="wiki-sidebar">
    <div class="wiki-sidebar__header">
      <div class="wiki-sidebar__title" @click="toggleDropdown">
        <div class="wiki-sidebar__title-content">
          <div v-if="projectId" class="wiki-sidebar__project-info">
            <span class="wiki-sidebar__project">{{ getProjectName }}</span>
            <div class="wiki-sidebar__stats">
              <span class="wiki-sidebar__stat">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M11.8687 13.3333L13.1954 13.3333C13.4836 13.3333 13.6279 13.3333 13.7491 13.2838C13.856 13.2401 13.9501 13.1691 14.0215 13.0783C14.1024 12.9754 14.1421 12.837 14.2214 12.5597L14.9452 10.0263C15.077 9.56473 15.1426 9.33392 15.0908 9.15133C15.0455 8.99138 14.9421 8.85417 14.8008 8.7666C14.6488 8.67242 14.4267 8.66696 14.0001 8.66665M11.8687 13.3333H4.13127M11.8687 13.3333C12.614 13.3333 12.9867 13.3333 13.2716 13.1881C13.5225 13.0603 13.727 12.856 13.8548 12.6051C14.0001 12.3199 14.0001 11.9466 14.0001 11.1998V8.66665M4.13127 13.3333H3.41406C2.93435 13.3333 2.69383 13.3333 2.53255 13.2334C2.39122 13.1458 2.28763 13.0085 2.24225 12.8486C2.23269 12.8149 2.22715 12.7795 2.22531 12.7414M4.13127 13.3333C3.386 13.3333 3.0128 13.3333 2.72786 13.1881C2.52416 13.0843 2.35148 12.9301 2.22531 12.7414M14.0001 8.66665C13.9739 8.66663 13.9469 8.66663 13.919 8.66663H3.33352L2.38867 11.9736L2.3873 11.9782C2.28056 12.3518 2.21718 12.5736 2.22531 12.7414M14.0001 8.66665L14.0001 6.13314C14.0001 5.38641 14.0001 5.01304 13.8548 4.72782C13.727 4.47694 13.5226 4.27312 13.2717 4.14528C12.9865 3.99996 12.6134 3.99996 11.8667 3.99996H8M2.22531 12.7414C2.19609 12.6977 2.16936 12.6522 2.14532 12.605C2 12.3198 2 11.9467 2 11.2V3.99996M2 3.99996H8M2 3.99996C2 3.26358 2.59695 2.66663 3.33333 2.66663H5.78301C6.10913 2.66663 6.27258 2.66663 6.42603 2.70347C6.56207 2.73613 6.6919 2.79014 6.8112 2.86324C6.94571 2.94567 7.06121 3.06117 7.29167 3.29163L8 3.99996"
                    stroke="#FEFEFE"
                    stroke-opacity="0.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>

                {{ wikiStore.wikiTree.length }}
              </span>
              <span class="wiki-sidebar__stat">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8.66663 13.3327C8.60337 13.3333 8.53238 13.3333 8.45131 13.3333H4.7979C4.05262 13.3333 3.67943 13.3333 3.39449 13.1881C3.14361 13.0603 2.93978 12.8561 2.81195 12.6052C2.66663 12.32 2.66663 11.9468 2.66663 11.2001V4.80009C2.66663 4.05335 2.66663 3.67971 2.81195 3.39449C2.93978 3.14361 3.14361 2.93978 3.39449 2.81195C3.67971 2.66663 4.05335 2.66663 4.80009 2.66663H11.2001C11.9468 2.66663 12.3197 2.66663 12.6049 2.81195C12.8558 2.93978 13.0603 3.14361 13.1881 3.39449C13.3333 3.67943 13.3333 4.05262 13.3333 4.7979V8.44977C13.3333 8.5315 13.3333 8.60298 13.3327 8.66663M8.66663 13.3327C8.85706 13.331 8.97751 13.3241 9.09252 13.2965C9.22857 13.2638 9.35853 13.2098 9.47782 13.1367C9.61238 13.0542 9.72769 12.9392 9.95829 12.7086L12.7086 9.95829C12.9392 9.72769 13.0539 9.61238 13.1363 9.47782C13.2094 9.35853 13.2635 9.22824 13.2962 9.0922C13.3238 8.97721 13.3309 8.85693 13.3327 8.66663M8.66663 13.3327V9.73336C8.66663 9.35999 8.66663 9.17317 8.73929 9.03056C8.8032 8.90512 8.90512 8.8032 9.03056 8.73929C9.17317 8.66663 9.35966 8.66663 9.73303 8.66663H13.3327"
                    stroke="#FEFEFE"
                    stroke-opacity="0.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>

                0
              </span>
            </div>
          </div>
          <div v-else class="wiki-sidebar__project-placeholder">
            <span>Проект не выбран</span>
          </div>
        </div>
        <div class="wiki-sidebar__dropdown">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
      <div v-if="isDropdownOpen" class="wiki-sidebar__dropdown-menu">
        <div
          v-for="project in projectStore.projects"
          :key="project.id"
          class="wiki-sidebar__dropdown-item"
          :class="{ 'wiki-sidebar__dropdown-item_active': project.id === projectId }"
          @click="selectProject(project.id)"
        >
          {{ project.name }}
        </div>
      </div>
    </div>

    <div v-if="projectId" class="wiki-sidebar__content">
      <div class="wiki-sidebar__section">
        <div class="wiki-sidebar__section-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M7.64317 12.3572L12.3572 7.64319M5.87571 9.41077L4.6972 10.5893C3.39546 11.891 3.39508 14.0017 4.69682 15.3035C5.99857 16.6052 8.10975 16.6048 9.4115 15.3031L10.5888 14.1247M9.41074 5.87492L10.5893 4.69641C11.891 3.39466 14.0013 3.39489 15.303 4.69664C16.6048 5.99839 16.6047 8.10896 15.303 9.41071L14.1251 10.5892"
              stroke="white"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <span>Быстрые ссылки</span>
          <button class="wiki-sidebar__add-btn" @click="toggleAddLinkForm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div v-if="isAddingLink" class="wiki-sidebar__add-link-form">
          <input
            v-model="newLinkTitle"
            type="text"
            placeholder="Название ссылки"
            class="wiki-sidebar__input"
            @keyup.enter="addQuickLink"
          />
          <input
            v-model="newLinkUrl"
            type="url"
            placeholder="https://example.com"
            class="wiki-sidebar__input"
            @keyup.enter="addQuickLink"
          />
          <div class="wiki-sidebar__form-actions">
            <button class="wiki-sidebar__btn wiki-sidebar__btn_primary" @click="addQuickLink">Добавить</button>
            <button class="wiki-sidebar__btn wiki-sidebar__btn_secondary" @click="cancelAddLink">Отмена</button>
          </div>
        </div>
        <div v-else class="wiki-sidebar__quick-links">
          <a
            v-for="link in quickLinkStore.quickLinks"
            :key="link.id"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="wiki-sidebar__quick-link"
          >
            <img :src="getFaviconUrl(link.url)" alt="" class="wiki-sidebar__favicon" />
            <span class="wiki-sidebar__link-title">{{ link.title }}</span>
            <button class="wiki-sidebar__delete-link" @click.prevent="deleteQuickLink(link.id)">×</button>
          </a>
        </div>
      </div>

      <div class="wiki-sidebar__section">
        <div class="wiki-sidebar__section-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M7.50008 14.1667H12.5001M7.50008 11.6667H12.5001M10.8337 2.50073C10.7541 2.5 10.6646 2.5 10.5623 2.5H6.83358C5.90016 2.5 5.4331 2.5 5.07658 2.68166C4.76298 2.84145 4.50819 3.09623 4.3484 3.40983C4.16675 3.76635 4.16675 4.23341 4.16675 5.16683V14.8335C4.16675 15.7669 4.16675 16.2334 4.3484 16.5899C4.50819 16.9035 4.76298 17.1587 5.07658 17.3185C5.43275 17.5 5.89925 17.5 6.83086 17.5L13.1693 17.5C14.1009 17.5 14.5667 17.5 14.9229 17.3185C15.2365 17.1587 15.4921 16.9035 15.6519 16.5899C15.8334 16.2337 15.8334 15.7679 15.8334 14.8363V7.7714C15.8334 7.66918 15.8333 7.57961 15.8326 7.5M10.8337 2.50073C11.0716 2.5029 11.2215 2.51172 11.3652 2.54623C11.5357 2.58705 11.6983 2.65439 11.8474 2.74577C12.0154 2.84881 12.1599 2.99318 12.448 3.28125L15.0526 5.88582C15.3408 6.17407 15.4841 6.3178 15.5872 6.486C15.6786 6.63512 15.7462 6.79771 15.787 6.96777C15.8215 7.11149 15.8304 7.26212 15.8326 7.5M10.8337 2.50073L10.8334 4.83351C10.8334 5.76693 10.8334 6.23346 11.0151 6.58998C11.1749 6.90358 11.4296 7.15873 11.7432 7.31852C12.0994 7.5 12.5659 7.5 13.4975 7.5H15.8326"
              stroke="white"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <span>Контент</span>
          <button class="wiki-sidebar__add-btn" @click="createNewPage">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="wiki-sidebar__items">
          <WikiMenuItem v-for="wikiTreeNode in wikiStore.wikiTree" :key="wikiTreeNode.id" :wiki-tree-node="wikiTreeNode" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PAGE_NAMES } from '~/constants/pages.constants';
import { useWikiStore } from '~/stores/wikiStore';
import { useQuickLinkStore } from '~/stores/quickLinkStore';
import { useNuxtApp } from '#app';
import { createWikiDnd, WikiDndKey } from '~/composables/useWikiDnd';

const projectStore = useProjectStore();
provide(WikiDndKey, createWikiDnd());
const wikiStore = useWikiStore();
const quickLinkStore = useQuickLinkStore();
const route = useRoute();
const router = useRouter();
const { $toast } = useNuxtApp();

const isDropdownOpen = ref(false);
const isAddingLink = ref(false);
const newLinkTitle = ref('');
const newLinkUrl = ref('');

const getProjectName = computed(() => {
  if (!route.query?.project_id) return '';
  const pId = route.query.project_id;
  if (Array.isArray(pId)) return '';
  const projectIdNum = Number(pId);
  if (Number.isNaN(projectIdNum)) return '';
  const findProject = projectStore.projects.find((project) => project.id === projectIdNum);
  if (!findProject) return '';
  return findProject.name;
});

const projectId = computed(() => {
  const pId = route.query?.project_id;
  if (!pId || Array.isArray(pId)) return null;
  const num = Number(pId);
  return Number.isNaN(num) ? null : num;
});

const { data: wikiPages } = await useAsyncData(`wiki-sidebar-${projectId.value}`, async () => {
  if (!projectId.value) return [];
  const pages = await wikiStore.fetchPages(projectId.value);
  return pages;
});

if (wikiPages.value && wikiPages.value.length > 0) {
  wikiStore.wikiTree = wikiPages.value;
}

await useAsyncData(`quick-links-${projectId.value}`, async () => {
  if (!projectId.value) return [];
  
  return await quickLinkStore.fetchQuickLinks(projectId.value);
});

watch(projectId, async (newProjectId) => {
  if (newProjectId) {
    const pages = await wikiStore.fetchPages(newProjectId);
    wikiStore.wikiTree = pages;
    await quickLinkStore.fetchQuickLinks(newProjectId);
  }
});

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value;
};

const selectProject = async (selectedProjectId: number) => {
  isDropdownOpen.value = false;
  wikiStore.selectedProjectId = selectedProjectId;
  try {
    await wikiStore.fetchPages(selectedProjectId);
  } catch (e) {
    console.error('Ошибка загрузки структуры wiki:', e);
  }
  await router.push({
    name: PAGE_NAMES.wiki,
    query: { project_id: selectedProjectId },
  });
};

const closeDropdown = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.wiki-sidebar__title')) {
    isDropdownOpen.value = false;
  }
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

    const { $toast } = useNuxtApp();
    $toast('Страница успешно создана');
  } catch (e) {
    console.error('Ошибка создания страницы:', e);
  }
};

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

const toggleAddLinkForm = () => {
  isAddingLink.value = !isAddingLink.value;
  if (!isAddingLink.value) {
    newLinkTitle.value = '';
    newLinkUrl.value = '';
  }
};

const cancelAddLink = () => {
  isAddingLink.value = false;
  newLinkTitle.value = '';
  newLinkUrl.value = '';
};

const addQuickLink = async () => {
  if (!newLinkUrl.value.trim()) {
    $toast.error('Введите URL');
    return;
  }

  if (!projectId.value) {
    $toast.error('Выберите проект');
    return;
  }

  try {
    await quickLinkStore.createQuickLink({
      url: newLinkUrl.value.trim(),
      title: newLinkTitle.value.trim() || undefined,
      project_id: projectId.value,
    });
    $toast('Ссылка успешно добавлена');
    cancelAddLink();
  } catch (e) {
    console.error('Ошибка при добавлении ссылки:', e);
    $toast.error('Ошибка при добавлении ссылки');
  }
};

const deleteQuickLink = async (id: number) => {
  try {
    await quickLinkStore.deleteQuickLink(id);
    $toast('Ссылка удалена');
  } catch (e) {
    console.error('Ошибка при удалении ссылки:', e);
    $toast.error('Ошибка при удалении ссылки');
  }
};

const getFaviconUrl = (url: string) => {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return 'https://www.google.com/s2/favicons?domain=example.com&sz=32';
  }
};

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});
</script>

<style scoped lang="scss">
.wiki-sidebar {
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
  padding: 16px;
  width: 300px;
  min-width: 300px;
  overflow-y: auto;
  @include flex(cn);
  gap: 0;
  transition: all 0.2s ease;
  background-color: var(--dark-text-background-primary);

  &__header {
    @include flex(cn);
    position: relative;
    flex-shrink: 0;
  }

  &__content {
    @include flex(cn);
    gap: 16px;
    width: 100%;
    padding-top: 16px;
  }

  &__title {
    @include flex(rn, a-center, between);
    gap: 8px;
    padding: 12px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__title-content {
    @include flex(rn, a-center);
    gap: 8px;
    flex: 1;
  }

  &__project-info {
    @include flex(cn);
    gap: 2px;
    flex: 1;
  }

  &__project-placeholder {
    @include flex(cn);
    gap: 8px;
    flex: 1;

    span {
      @extend %text-s-medium;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__project {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__stats {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__stat {
    @include flex(rn, a-center);
    gap: 4px;
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);

    svg {
      width: 14px;
      height: 14px;
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__dropdown {
    @include flex(center);
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--light-text-backgroung-primary);

    svg {
      stroke: currentColor;
      width: 16px;
      height: 16px;
    }
  }

  &__dropdown-menu {
    position: absolute;
    top: 56px;
    left: 0;
    right: 0;
    background: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 8px;
    z-index: 100;
    max-height: 300px;
    overflow-y: auto;
    box-shadow: 0 4px 12px var(--black-50);
  }

  &__dropdown-item {
    padding: 10px 12px;
    border-radius: 6px;
    cursor: pointer;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    transition: all 0.2s ease;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_active {
      background: var(--primary-25);
      color: var(--primary);
    }
  }

  &__section {
    @include flex(cn);
    gap: 12px;
  }

  &__section-header {
    @include flex(rn, a-center);
    gap: 8px;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);

    svg {
      width: 16px;
      height: 16px;
      stroke: var(--light-text-backgroung-primary-50);
      flex-shrink: 0;
    }

    span {
      flex: 1;
    }
  }

  &__add-btn {
    @include flex(center);
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--primary);
    border: none;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;

    &:hover {
      background: var(--primary-dark);
    }

    svg {
      width: 14px;
      height: 14px;
      stroke: var(--light-text-backgroung-primary);
    }
  }

  &__items {
    overflow-y: auto;
    @include flex(cn);
    gap: 2px;
    padding-left: 4px;
  }

  &__add-link-form {
    @include flex(cn);
    gap: 8px;
    padding: 12px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
  }

  &__input {
    width: 100%;
    padding: 8px 12px;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    transition: all 0.2s ease;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    &:focus {
      outline: none;
      border-color: var(--primary);
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__form-actions {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    @extend %text-s-medium;
    transition: all 0.2s ease;

    &_primary {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);

      &:hover {
        background: var(--primary-dark);
      }
    }

    &_secondary {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);

      &:hover {
        background: var(--light-text-backgroung-primary-10);
      }
    }
  }

  &__quick-links {
    @include flex(cn);
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
    padding-right: 4px;

    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-track {
      background: var(--light-text-backgroung-primary-5);
      border-radius: 2px;
    }

    &::-webkit-scrollbar-thumb {
      background: var(--light-text-backgroung-primary-25);
      border-radius: 2px;

      &:hover {
        background: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__quick-link {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 8px 12px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 6px;
    text-decoration: none;
    transition: all 0.2s ease;
    position: relative;

    &:hover {
      background: var(--light-text-backgroung-primary-10);

      .wiki-sidebar__delete-link {
        opacity: 1;
      }
    }
  }

  &__favicon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 2px;
  }

  &__link-title {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__delete-link {
    @include flex(center);
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary-50);
    transition: all 0.2s ease;
    opacity: 0;
    flex-shrink: 0;
    font-size: 20px;
    line-height: 1;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
  }
}
</style>
