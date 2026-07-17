<script setup lang="ts">
import { buildFileTree, navigateToPath, getExtensionType, formatFileSize } from '~/utils/wiki/fileTree';
import type { FileTreeNode, FileTreeFile } from '~/utils/wiki/fileTree';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';

defineOptions({ name: 'WikiFileExplorer' });

const props = defineProps<{
  projectId: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-markdown', key: string, name: string): void;
}>();

const config = useRuntimeConfig();
const filesStore = useFilesStore();
const { $toast } = useNuxtApp();

const AWS_ENDPOINT = config.public.AWS_ENDPOINT as string;
const scopeId = computed(() => props.projectId);
const basePrefix = computed(() => `tracker-project-wiki/${scopeId.value}/`);

const currentPath = ref<string[]>([]);
const previewFile = ref<FileTreeFile | null>(null);
const isUploading = ref(false);
const uploadInputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

const isCreatingFolder = ref(false);
const newFolderName = ref('');
const newFolderInputRef = ref<HTMLInputElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const justUploadedKeys = ref<Set<string>>(new Set());

const isFilesReady = ref(false);
watch(
  () => scopeId.value,
  async () => {
    isFilesReady.value = false;
    currentPath.value = [];
    await filesStore.fetchFiles(basePrefix.value);
  },
  { immediate: true },
);
watch(
  () => filesStore.isLoading,
  (loading) => {
    if (!loading) isFilesReady.value = true;
  },
  { immediate: true },
);

const fullTree = computed(() => buildFileTree(filesStore.files, basePrefix.value));
const currentNodes = computed(() => navigateToPath(fullTree.value, currentPath.value));

const currentPrefix = computed(() => {
  const parts = currentPath.value;
  return basePrefix.value + (parts.length ? parts.join('/') + '/' : '');
});

const fileUrl = (key: string) => buildAwsObjectUrl(key, AWS_ENDPOINT) ?? key;

const openFolder = (name: string) => {
  currentPath.value = [...currentPath.value, name];
  previewFile.value = null;
};

const navigateTo = (index: number) => {
  currentPath.value = currentPath.value.slice(0, index);
  previewFile.value = null;
};

type CrumbItem =
  | { type: 'root'; isCurrent: boolean }
  | { type: 'ellipsis'; index: number }
  | { type: 'segment'; label: string; index: number; isCurrent: boolean };

const visibleCrumbs = computed((): CrumbItem[] => {
  const path = currentPath.value;
  if (path.length === 0) {
    return [{ type: 'root', isCurrent: true }];
  }
  if (path.length <= 2) {
    const items: CrumbItem[] = [{ type: 'root', isCurrent: false }];
    path.forEach((label, i) => {
      items.push({ type: 'segment', label, index: i + 1, isCurrent: i === path.length - 1 });
    });
    return items;
  }
  return [
    { type: 'root', isCurrent: false },
    { type: 'ellipsis', index: path.length - 2 },
    { type: 'segment', label: path[path.length - 2], index: path.length - 1, isCurrent: false },
    { type: 'segment', label: path[path.length - 1], index: path.length, isCurrent: true },
  ];
});

const openFile = (node: FileTreeFile) => {
  const ext = getExtensionType(node.extension);
  if (ext === 'image' || ext === 'video') {
    previewFile.value = node;
  } else if (ext === 'markdown') {
    emit('open-markdown', node.key, node.name);
  } else {
    const link = document.createElement('a');
    link.href = fileUrl(node.key);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = node.name;
    link.click();
  }
};

const closePreview = () => {
  previewFile.value = null;
};

const uploadFiles = async (fileList: FileList | File[]) => {
  const files = Array.from(fileList);
  if (!files.length) return;

  isUploading.value = true;
  const uploadedKeys: string[] = [];
  try {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('prefix', currentPrefix.value);
      const result = await filesStore.addFile(formData);
      if (result?.Key) uploadedKeys.push(result.Key);
    }
    await filesStore.fetchFiles(basePrefix.value);
    $toast(files.length > 1 ? `Загружено файлов: ${files.length}` : 'Файл загружен');

    if (uploadedKeys.length) {
      justUploadedKeys.value = new Set(uploadedKeys);
      await nextTick();
      const firstKey = uploadedKeys[0];
      const el = bodyRef.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(firstKey)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => {
        justUploadedKeys.value = new Set();
      }, 1500);
    }
  } catch {
    $toast.error('Ошибка при загрузке файла');
  } finally {
    isUploading.value = false;
  }
};

const triggerUpload = () => {
  uploadInputRef.value?.click();
};

const handleUploadInput = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!files.length) return;
  await uploadFiles(files);
};

const onDragOver = (event: DragEvent) => {
  event.preventDefault();
  isDragging.value = true;
};

const onDragLeave = () => {
  isDragging.value = false;
};

const onDrop = async (event: DragEvent) => {
  event.preventDefault();
  isDragging.value = false;
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  await uploadFiles(files);
};

const startCreateFolder = async () => {
  isCreatingFolder.value = true;
  await nextTick();
  newFolderInputRef.value?.focus();
};

const cancelCreateFolder = () => {
  isCreatingFolder.value = false;
  newFolderName.value = '';
};

const confirmCreateFolder = async () => {
  const name = newFolderName.value.trim();
  if (!name) return;

  try {
    await filesStore.createFolder(currentPrefix.value, name);
    await filesStore.fetchFiles(basePrefix.value);
    $toast('Папка создана');
    cancelCreateFolder();
  } catch {
    $toast.error('Ошибка при создании папки');
  }
};

const nodeIcon = (node: FileTreeNode): string => {
  if (node.type === 'folder') return 'folder';
  return getExtensionType(node.extension);
};

const confirmDeleteNode = ref<FileTreeNode | null>(null);
const isDeleting = ref(false);

const requestDelete = (event: MouseEvent, node: FileTreeNode) => {
  event.stopPropagation();
  confirmDeleteNode.value = node;
};

const cancelDelete = () => {
  confirmDeleteNode.value = null;
};

const confirmDelete = async () => {
  const node = confirmDeleteNode.value;
  if (!node) return;
  isDeleting.value = true;
  try {
    if (node.type === 'folder') {
      const prefix = currentPrefix.value + node.name + '/';
      await filesStore.deleteFolder(prefix);
      $toast('Папка удалена');
    } else {
      await filesStore.deleteFile(node.key);
      $toast('Файл удалён');
    }
    confirmDeleteNode.value = null;
  } catch {
    $toast.error('Ошибка при удалении');
  } finally {
    isDeleting.value = false;
  }
};
</script>

<template>
  <div
    class="wiki-explorer"
    :class="{ 'wiki-explorer_dragging': isDragging }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <Transition name="explorer-fade">
      <div v-if="isDragging" class="wiki-explorer__dnd-overlay">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path
            d="M22 6v26M10 18l12-12 12 12M7 38h30"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>Отпустите для загрузки</span>
      </div>
    </Transition>

    <div class="wiki-explorer__toolbar">
      <button class="wiki-explorer__tool-btn" :disabled="isUploading" @click="triggerUpload">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path
            d="M7 1v8M3 5l4-4 4 4M2 11h10"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ isUploading ? 'Загрузка...' : 'Загрузить' }}</span>
      </button>
      <button class="wiki-explorer__tool-btn wiki-explorer__tool-btn_ghost" @click="startCreateFolder">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path
            d="M1.5 3.5a1 1 0 0 1 1-1h2.086a1 1 0 0 1 .707.293L6.5 4H12a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path d="M7 6.5v3M5.5 8h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <span>Папка</span>
      </button>
      <button class="wiki-explorer__close-btn" title="Закрыть" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="wiki-explorer__breadcrumbs">
      <template v-for="(crumb, i) in visibleCrumbs" :key="i">
        <span v-if="i > 0" class="wiki-explorer__crumb-sep">›</span>
        <template v-if="crumb.type === 'root'">
          <span v-if="crumb.isCurrent" class="wiki-explorer__crumb wiki-explorer__crumb_current">Корень</span>
          <button v-else class="wiki-explorer__crumb" @click="navigateTo(0)">Корень</button>
        </template>
        <button
          v-else-if="crumb.type === 'ellipsis'"
          class="wiki-explorer__crumb wiki-explorer__crumb-ellipsis"
          title="Перейти к скрытому уровню"
          @click="navigateTo(crumb.index)"
        >
          …
        </button>
        <template v-else-if="crumb.type === 'segment'">
          <span v-if="crumb.isCurrent" class="wiki-explorer__crumb wiki-explorer__crumb_current" :title="crumb.label">{{
            crumb.label
          }}</span>
          <button
            v-else
            class="wiki-explorer__crumb wiki-explorer__crumb_truncated"
            :title="crumb.label"
            @click="navigateTo(crumb.index)"
          >
            {{ crumb.label }}
          </button>
        </template>
      </template>
    </div>

    <div ref="bodyRef" class="wiki-explorer__body">
      <div v-if="isCreatingFolder" class="wiki-explorer__new-folder">
        <div class="wiki-explorer__item-icon wiki-explorer__item-icon_folder">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M1.5 5.25A1.5 1.5 0 0 1 3 3.75h2.629a1.5 1.5 0 0 1 1.06.44L7.5 5.25h7.5A1.5 1.5 0 0 1 16.5 6.75v7.5A1.5 1.5 0 0 1 15 15.75H3A1.5 1.5 0 0 1 1.5 14.25V5.25z"
              stroke="currentColor"
              stroke-width="1.3"
              fill="none"
            />
          </svg>
        </div>
        <input
          ref="newFolderInputRef"
          v-model="newFolderName"
          class="wiki-explorer__folder-input"
          placeholder="Название папки"
          @keyup.enter="confirmCreateFolder"
          @keyup.escape="cancelCreateFolder"
        />
        <button class="wiki-explorer__action-btn wiki-explorer__action-btn_confirm" title="Создать" @click="confirmCreateFolder">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button class="wiki-explorer__action-btn" title="Отмена" @click="cancelCreateFolder">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div v-if="!isFilesReady || filesStore.isLoading" class="wiki-explorer__loading">
        <svg class="wiki-explorer__spinner" width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle
            cx="14"
            cy="14"
            r="11"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-dasharray="52 17"
          />
        </svg>
      </div>

      <div v-else-if="currentNodes.length === 0 && !isCreatingFolder" class="wiki-explorer__empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path
            d="M6 13a3 3 0 0 1 3-3h7l5 5h17a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V13z"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <path d="M24 22v8M20 26h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span class="wiki-explorer__empty-title">Папка пуста</span>
        <span class="wiki-explorer__empty-hint">Перетащите файлы сюда или нажмите «Загрузить»</span>
      </div>

      <div
        v-for="node in currentNodes"
        :key="node.type === 'file' ? node.key : node.name"
        :data-key="node.type === 'file' ? node.key : undefined"
        :class="[
          'wiki-explorer__item',
          { 'wiki-explorer__item_just-uploaded': node.type === 'file' && justUploadedKeys.has(node.key) },
        ]"
        :title="node.name"
        @click="node.type === 'folder' ? openFolder(node.name) : openFile(node)"
      >
        <div
          class="wiki-explorer__item-icon"
          :class="[
            `wiki-explorer__item-icon_${nodeIcon(node)}`,
            { 'wiki-explorer__item-icon_thumb': node.type === 'file' && (getExtensionType(node.extension) === 'image' || getExtensionType(node.extension) === 'video') },
          ]"
        >
          <svg v-if="node.type === 'folder'" width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M1.5 5.25A1.5 1.5 0 0 1 3 3.75h2.629a1.5 1.5 0 0 1 1.06.44L7.5 5.25h7.5A1.5 1.5 0 0 1 16.5 6.75v7.5A1.5 1.5 0 0 1 15 15.75H3A1.5 1.5 0 0 1 1.5 14.25V5.25z"
              stroke="currentColor"
              stroke-width="1.3"
              fill="none"
            />
          </svg>
          <template v-else-if="getExtensionType(node.extension) === 'image'">
            <img
              :src="fileUrl(node.key)"
              :alt="node.name"
              class="wiki-explorer__thumb"
              loading="lazy"
              decoding="async"
            />
          </template>
          <template v-else-if="getExtensionType(node.extension) === 'video'">
            <video
              :src="fileUrl(node.key)"
              class="wiki-explorer__thumb"
              preload="metadata"
              muted
              playsinline
            />
            <div class="wiki-explorer__thumb-play">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 1.5l7 3.5-7 3.5V1.5z" fill="currentColor" />
              </svg>
            </div>
          </template>
          <svg v-else-if="getExtensionType(node.extension) === 'markdown'" width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" stroke-width="1.3" />
            <path
              d="M4.5 12V6l2.5 2.5L9.5 6v6M12.5 12l-1.5-3"
              stroke="currentColor"
              stroke-width="1.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M10 1.5H4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6l-5.5-4.5z"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <path d="M10 1.5V6H14.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        </div>
        <div class="wiki-explorer__item-info">
          <span class="wiki-explorer__item-name">{{ node.name }}</span>
          <span v-if="node.type === 'file' && node.size != null" class="wiki-explorer__item-size">
            {{ formatFileSize(node.size) }}
          </span>
        </div>
        <div class="wiki-explorer__item-tail">
          <a
            v-if="node.type !== 'folder'"
            :href="fileUrl(node.key)"
            target="_blank"
            rel="noopener noreferrer"
            :download="node.name"
            class="wiki-explorer__item-download"
            @click.stop
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M6.5 1v8M3 10l3.5 2.5L10 10M1 12.5h11"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </a>
          <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="none" class="wiki-explorer__item-chevron">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <button class="wiki-explorer__item-delete" title="Удалить" @click="requestDelete($event, node)">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M3 4.5h12M7.5 4.5V3h3v1.5M5.5 4.5v9.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="confirmDeleteNode" class="wiki-explorer__confirm-overlay" @click.self="cancelDelete">
        <div class="wiki-explorer__confirm">
          <p class="wiki-explorer__confirm-text">
            Удалить {{ confirmDeleteNode.type === 'folder' ? 'папку' : 'файл' }} <strong>{{ confirmDeleteNode.name }}</strong
            >?
          </p>
          <p v-if="confirmDeleteNode.type === 'folder'" class="wiki-explorer__confirm-hint">
            Все файлы внутри будут удалены безвозвратно.
          </p>
          <div class="wiki-explorer__confirm-actions">
            <button
              class="wiki-explorer__confirm-btn wiki-explorer__confirm-btn_cancel"
              :disabled="isDeleting"
              @click="cancelDelete"
            >
              Отмена
            </button>
            <button
              class="wiki-explorer__confirm-btn wiki-explorer__confirm-btn_delete"
              :disabled="isDeleting"
              @click="confirmDelete"
            >
              {{ isDeleting ? 'Удаление...' : 'Удалить' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="previewFile" class="wiki-explorer__preview-overlay" @click.self="closePreview">
        <div class="wiki-explorer__preview">
          <div class="wiki-explorer__preview-header">
            <span class="wiki-explorer__preview-name">{{ previewFile.name }}</span>
            <button class="wiki-explorer__close-btn" @click="closePreview">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <div class="wiki-explorer__preview-body">
            <img
              v-if="getExtensionType(previewFile.extension) === 'image'"
              :src="fileUrl(previewFile.key)"
              :alt="previewFile.name"
              class="wiki-explorer__preview-image"
            />
            <video
              v-else-if="getExtensionType(previewFile.extension) === 'video'"
              :src="fileUrl(previewFile.key)"
              controls
              class="wiki-explorer__preview-video"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <input ref="uploadInputRef" type="file" multiple class="wiki-explorer__hidden-input" @change="handleUploadInput" />
  </div>
</template>

<style scoped lang="scss">
.explorer-fade-enter-active,
.explorer-fade-leave-active {
  transition: opacity 0.15s ease;
}
.explorer-fade-enter-from,
.explorer-fade-leave-to {
  opacity: 0;
}

.wiki-explorer {
  width: 320px;
  min-width: 320px;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
  @include flex(cn);
  background: var(--light-text-backgroung-primary-5);
  border-radius: 8px;
  position: relative;

  &_dragging {
    outline: 2px dashed var(--primary);
    outline-offset: -2px;
  }

  &__dnd-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: var(--black-50);
    @include flex(cn, a-center);
    gap: 14px;
    color: var(--primary-100);
    @extend %p14-bold;
    pointer-events: none;
    border-radius: 8px;
    text-align: center;
    padding: 24px;

    svg {
      stroke: currentColor;
    }
  }

  &__toolbar {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__tool-btn {
    @include flex(rn, a-center);
    gap: 5px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--primary-dark);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-medium;
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
    white-space: nowrap;
    border: none;

    svg {
      stroke: currentColor;
      flex-shrink: 0;
    }

    &:hover:not(:disabled) {
      background: var(--primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &_ghost {
      background: transparent;
      border: 1px solid var(--light-text-backgroung-primary-25);
      color: var(--light-text-backgroung-primary-50);

      &:hover:not(:disabled) {
        background: var(--light-text-backgroung-primary-10);
        color: var(--light-text-backgroung-primary);
        border-color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__close-btn {
    @include flex(center);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex-shrink: 0;
    margin-left: auto;
    cursor: pointer;
    background: transparent;
    border: none;
    transition:
      background 0.15s ease,
      color 0.15s ease;
    color: var(--light-text-backgroung-primary-50);

    svg {
      stroke: currentColor;
    }

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__breadcrumbs {
    @include flex(rn, a-center);
    flex-wrap: nowrap;
    gap: 2px;
    padding: 5px 12px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    min-height: 32px;
    overflow: hidden;
  }

  &__crumb {
    @extend %text-xs-regular;
    color: var(--primary-100);
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 4px;
    background: transparent;
    border: none;
    transition: background 0.12s ease;
    white-space: nowrap;
    flex-shrink: 0;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &_current {
      color: var(--light-text-backgroung-primary-50);
      cursor: default;
      pointer-events: none;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 1;
      min-width: 0;
      background: transparent;
    }

    &_truncated {
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100px;
    }
  }

  &__crumb-sep {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-25);
    padding: 0 1px;
    flex-shrink: 0;
  }

  &__crumb-ellipsis {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-25);
    padding: 0 3px;
    flex-shrink: 0;
    user-select: none;
  }

  &__body {
    @include flex(cn);
    gap: 1px;
    padding: 6px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  &__new-folder {
    @include flex(rn, a-center);
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-10);
    border: 1px solid var(--primary-25);
    flex-shrink: 0;
    margin-bottom: 2px;
  }

  &__folder-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    min-width: 0;

    &::placeholder {
      color: var(--light-text-backgroung-primary-25);
    }
  }

  &__action-btn {
    @include flex(center);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex-shrink: 0;
    cursor: pointer;
    background: transparent;
    border: none;
    transition:
      background 0.12s ease,
      color 0.12s ease;
    color: var(--light-text-backgroung-primary-50);

    svg {
      stroke: currentColor;
      width: 16px;
      height: 16px;
    }

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &_confirm {
      color: var(--green);

      &:hover {
        background: var(--green-10);
        color: var(--green);
      }
    }
  }

  &__loading {
    @include flex(rn, a-center, j-center);
    padding: 48px 20px;
    color: var(--primary-100);
  }

  &__spinner {
    animation: wiki-spinner-rotate 0.9s linear infinite;
    opacity: 0.6;
  }

  @keyframes wiki-spinner-rotate {
    to {
      transform: rotate(360deg);
    }
  }

  &__empty {
    @include flex(cn, a-center);
    gap: 10px;
    padding: 48px 20px 32px;
    color: var(--light-text-backgroung-primary-25);
    text-align: center;

    svg {
      stroke: currentColor;
      opacity: 0.4;
      flex-shrink: 0;
    }
  }

  &__empty-title {
    @extend %p14-medium;
    color: var(--light-text-backgroung-primary-50);
  }

  &__empty-hint {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-25);
    max-width: 200px;
    line-height: 1.5;
  }

  &__item {
    @include flex(rn, a-center);
    gap: 10px;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease;
    flex-shrink: 0;

    &:hover {
      background: var(--light-text-backgroung-primary-10);

      .wiki-explorer__item-tail {
        opacity: 1;
      }
    }

    &_just-uploaded {
      animation: wiki-item-highlight 1.5s ease forwards;
    }
  }

  @keyframes wiki-item-highlight {
    0% {
      background: var(--primary-50);
    }
    60% {
      background: var(--primary-25);
    }
    100% {
      background: transparent;
    }
  }

  &__item-icon {
    @include flex(center);
    width: 30px;
    height: 30px;
    border-radius: 6px;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;

    svg {
      stroke: currentColor;
    }

    &_folder {
      background: var(--primary-25);
      color: var(--primary);
    }
    &_image {
      background: var(--green-10);
      color: var(--green);
    }
    &_video {
      background: var(--accent-15);
      color: var(--accent);
    }
    &_markdown {
      background: var(--primary-25);
      color: var(--primary-100);
    }
    &_other {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
    }

    &_thumb {
      width: 48px;
      height: 48px;
      border-radius: 6px;
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 6px;
  }

  &__thumb-play {
    position: absolute;
    inset: 0;
    @include flex(center);
    background: var(--black-50);
    color: var(--light-text-backgroung-primary);
    pointer-events: none;
  }

  &__item-info {
    @include flex(cn);
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  &__item-name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__item-size {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-25);
  }

  &__item-tail {
    @include flex(rn, a-center);
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  &__item-download {
    @include flex(center);
    width: 28px;
    height: 28px;
    border-radius: 4px;
    color: var(--light-text-backgroung-primary-50);
    transition: all 0.12s ease;

    svg {
      stroke: currentColor;
      width: 16px;
      height: 16px;
    }

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__item-chevron {
    stroke: var(--light-text-backgroung-primary-25);
    width: 14px;
    height: 14px;
  }

  &__item-delete {
    @include flex(center);
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--light-text-backgroung-primary-25);
    cursor: pointer;
    transition: all 0.12s ease;
    flex-shrink: 0;

    svg {
      stroke: currentColor;
      width: 16px;
      height: 16px;
    }

    &:hover {
      background: var(--danger-delete-10);
      color: var(--danger-delete);
    }
  }

  &__confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 10001;
    background: var(--black-50);
    backdrop-filter: blur(4px);
    @include flex(center);
  }

  &__confirm {
    background: var(--dark-text-background-primary);
    border: 1px solid var(--danger-delete-25);
    border-radius: 12px;
    padding: 24px;
    max-width: 360px;
    width: calc(100% - 32px);
    @include flex(cn);
    gap: 12px;
    box-shadow: 0 16px 48px var(--black-50);
  }

  &__confirm-text {
    @extend %text-m-regular;
    color: var(--light-text-backgroung-primary);
    margin: 0;
    line-height: 1.5;
    word-break: break-word;

    strong {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__confirm-hint {
    @extend %text-xs-regular;
    color: var(--danger-delete);
    margin: 0;
  }

  &__confirm-actions {
    @include flex(rn, a-center);
    gap: 10px;
    justify-content: flex-end;
    margin-top: 4px;
  }

  &__confirm-btn {
    padding: 8px 18px;
    border-radius: 8px;
    @extend %text-s-medium;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &_cancel {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
      &:hover:not(:disabled) {
        background: var(--light-text-backgroung-primary-25);
      }
    }

    &_delete {
      background: var(--danger-delete-10);
      color: var(--danger-delete);
      border: 1px solid var(--danger-delete-25);
      &:hover:not(:disabled) {
        background: var(--danger-delete-25);
      }
    }
  }

  &__preview-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: var(--black-50);
    backdrop-filter: blur(12px);
    @include flex(cn, a-center);
    padding: 24px;
  }

  &__preview {
    @include flex(cn);
    background: var(--dark-text-background-primary);
    border-radius: 12px;
    overflow: hidden;
    max-width: 90vw;
    max-height: 90vh;
    width: auto;
    box-shadow: 0 24px 64px var(--black-50);
  }

  &__preview-header {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__preview-name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__preview-body {
    @include flex(center);
    flex: 1;
    min-height: 0;
    padding: 16px;
    overflow: auto;
  }

  &__preview-image {
    max-width: 100%;
    max-height: calc(90vh - 60px);
    object-fit: contain;
    border-radius: 6px;
  }

  &__preview-video {
    max-width: 100%;
    max-height: calc(90vh - 60px);
    border-radius: 6px;
  }

  &__hidden-input {
    display: none;
  }
}
</style>
