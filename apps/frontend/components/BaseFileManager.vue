<script setup lang="ts">
import IconAddFile from '~/components/Icons/IconAddFile.vue';
import { getErrorMessage } from '~/utils/error';
import IconAddImage from './Icons/IconAddImage.vue';
import IconAddVideo from './Icons/IconAddVideo.vue';
import IconCode from './Icons/IconCode.vue';
import { useFileName } from '../composables/useFileName';
import IconMp3 from './Icons/IconMp3.vue';
import IconQuestion from './Icons/IconQuestion.vue';
import IconFile from './Icons/IconFile.vue';
import IconDownload from './Icons/IconDownload.vue';
import IconTrash from './Icons/IconTrash.vue';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';

const { $toast } = useNuxtApp();
const filesStore = useFilesStore();
const wikiStore = useWikiStore();
const route = useRoute();
const config = useRuntimeConfig();

const props = defineProps<{
  mode?: 'image' | 'video' | 'file' | 'embed';
  selectorDisabled?: boolean;
  videoValue?: string;
}>();

const { getFileNameWithExtension, getFileExt } = useFileName();

enum fileMode {
  image = 'image',
  video = 'video',
  file = 'file',
  embed = 'embed',
}

enum modeInsertText {
  image = 'Выберите изображение',
  video = 'Выберите видео',
  file = 'Выберите файл',
  embed = 'Вставьте код',
}

const emit = defineEmits(['insert-img', 'insert-video', 'insert-code', 'insert-file']);

const mode = ref(props.mode ?? fileMode.image);

enum modeNames {
  image = 'Изображение',
  video = 'Видео',
  file = 'Файл',
  embed = 'Embed',
}

const modeIcons = {
  image: IconAddImage,
  video: IconAddVideo,
  file: IconAddFile,
  embed: IconCode,
};

const fileIcons: { [key: string]: { icon: Component; color: string } } = {
  jpeg: { icon: IconAddImage, color: '#F59E0B' },
  png: { icon: IconAddImage, color: '#10B981' },
  gif: { icon: IconAddImage, color: '#059669' },
  mp3: { icon: IconMp3, color: '#38AEF7' },
  mp4: { icon: IconAddVideo, color: '#06B6D4' },
  docx: { icon: IconFile, color: '#513ACF' },
  doc: { icon: IconFile, color: '#513ACF' },
  pdf: { icon: IconFile, color: '#F43F5E' },
};

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<string>('');
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const videoTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/avi', 'video/mov'];
const maxSize = 1024 * 1024 * 1024;

const AWS_ENDPOINT = config.public.AWS_ENDPOINT;

const imageExts = ['jpeg', 'jpg', 'png', 'webp', 'svg'];
const videoExts = ['mp4', 'webm', 'ogg', 'avi', 'mov'];

const acceptAttr = computed(() => {
  if (mode.value === fileMode.image) return imageTypes.join(', ');
  if (mode.value === fileMode.video) return videoTypes.join(', ');
  return '*/*';
});

const filteredFiles = computed(() => {
  return filesStore.files.filter((file) => {
    const parts = file.Key.split('.');
    if (parts.length < 2) return mode.value === fileMode.file;
    const ext = parts.pop()!.toLowerCase();
    if (mode.value === fileMode.image) return imageExts.includes(ext);
    if (mode.value === fileMode.video) return videoExts.includes(ext);
    return !imageExts.includes(ext) && !videoExts.includes(ext);
  });
});

const currentTaskId = computed<number | null>(() => {
  const q = route.query['task-id'];
  if (!q) return null;
  const val = Array.isArray(q) ? q[0] : q;
  const n = Number(val);
  return Number.isInteger(n) ? n : null;
});

const currentChatId = computed<string | null>(() => {
  const q = route.query.chatId;
  if (!q) return null;
  return Array.isArray(q) ? q[0] : q;
});

const currentWikiProjectId = computed<number | null>(() => {
  const q = route.query.project_id;
  const val = Array.isArray(q) ? q[0] : q;
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : wikiStore.selectedProjectId;
});

const prefix = computed(() => {
  if (wikiStore.currentPage && currentWikiProjectId.value) {
    return `tracker-project-wiki/${currentWikiProjectId.value}/`;
  }
  if (currentChatId.value) {
    return `tracker-chat/${currentChatId.value}/`;
  }
  return `tracker-tasks/${currentTaskId.value}/`;
});

const formatSizeMb = (bytes?: number) => {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${mb.toFixed(2)}MB`;
};

const downloadFile = async (key: string) => {
  try {
    const response = await fetch(buildAwsObjectUrl(key, AWS_ENDPOINT) ?? key);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getFileNameWithExtension(key) || 'file';
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const allowedTypes = computed(() =>
  mode.value === fileMode.image ? imageTypes : mode.value === fileMode.video ? videoTypes : [],
);

const videoCode = ref<string>(props.videoValue || '');

const openFileDialog = () => {
  fileInput.value?.click();
};

const selectFile = (file: string) => {
  selectedFile.value = file;
};

const checkFileIntegrity = (file: File): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img.width > 0 && img.height > 0);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(false);
    };

    img.src = objectUrl;
  });
};

const handleFileChange = async (event: Event) => {
  try {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    if (mode.value !== fileMode.file && !allowedTypes.value.includes(file.type)) {
      $toast.error(mode.value === fileMode.video ? 'Неподдерживаемый видео-формат' : 'Неподдерживаемый формат изображения');
      return;
    }

    if (mode.value === fileMode.file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      $toast.error('Этот раздел для файлов другого расширения. Используйте вкладку изображений или видео.');
      return;
    }

    if (file.size > maxSize) {
      $toast.error(`Максимальный размер: ${maxSize / 1024 / 1024 / 1024} ГБ`);
      return;
    }

    if (file?.size === 0) {
      $toast.error('Файл пуст. Выберите другой файл');
      return;
    }

    if (mode.value === fileMode.image) {
      const isValid = await checkFileIntegrity(file);
      if (!isValid) {
        $toast.error('Изображение некорректно. Выберите другой файл');
        return;
      }
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('prefix', prefix.value);

    const result = await filesStore.addFile(formData);
    selectedFile.value = result.Key;

    if (mode.value === fileMode.image) $toast('Изображение успешно загружено');
    else if (mode.value === fileMode.video || mode.value === fileMode.embed) $toast('Видео успешно загружено');
    else $toast('Файл успешно загружён');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const setFile = () => {
  if (!selectedFile.value && mode.value !== fileMode.embed) return;
  if (mode.value === fileMode.embed) {
    emit('insert-code', videoCode.value);
  } else if (mode.value === fileMode.video) {
    emit('insert-video', selectedFile.value);
  } else if (mode.value === fileMode.image) {
    emit('insert-img', selectedFile.value);
  } else {
    emit('insert-file', selectedFile.value);
  }
};
</script>

<template>
  <div class="file-manager">
    <div class="file-manager__header">
      <div class="file-manager__header-top">
        <div class="file-manager__header-logo">
          <IconAddFile />
        </div>
        <div class="file-manager__header-info">
          Файловый менеджер
          <span>
            {{ modeInsertText[mode] }}
          </span>
        </div>
      </div>
      <div v-if="!selectorDisabled" class="file-manager__header-selectors">
        <div
          v-for="(value, key) of modeNames"
          :key="key"
          class="file-manager__header-selector"
          :class="{ 'file-manager__header-selector_active': mode === key }"
          @click="mode = key"
        >
          <component :is="modeIcons[key]" />
          <span>{{ value }}</span>
        </div>
      </div>
    </div>
    <template v-if="mode !== fileMode.embed">
      <div class="file-manager__items-wrapper">
        <div :class="['file-manager__items', { 'file-manager__items_file': mode === fileMode.file }]">
          <div
            :class="[
              'file-manager__item',
              'file-manager__item_input',
              { 'file-manager__item_small-input': mode === fileMode.file },
            ]"
            @click="openFileDialog"
          >
            <component :is="modeIcons[mode]" />
            <span>Загрузить {{ modeNames[mode].toLowerCase() }}</span>
            <input ref="fileInput" type="file" :accept="acceptAttr" hidden @change="handleFileChange" />
          </div>
          <div
            v-for="file of filteredFiles"
            :key="file.Key"
            :class="[
              'file-manager__item',
              { 'file-manager__item_small': mode === fileMode.file, 'file-manager__item_active': file.Key === selectedFile },
            ]"
            @click="selectFile(file.Key)"
          >
            <img v-if="mode === fileMode.image" :src="buildAwsObjectUrl(file.Key, AWS_ENDPOINT)" alt="Изображение" />
            <video v-if="mode === fileMode.video" :src="buildAwsObjectUrl(file.Key, AWS_ENDPOINT)"></video>
            <div v-if="mode !== fileMode.file" class="file-manager__options">
              <div @click.stop="downloadFile(file.Key)">
                <IconDownload />
              </div>
              <IconTrash v-if="false" />
            </div>
            <div v-if="mode === fileMode.file" class="file-manager__item-file">
              <div class="file-manager__item-file-icon" :style="{ 'background-color': fileIcons[getFileExt(file.Key)]?.color }">
                <component :is="fileIcons[getFileExt(file.Key)].icon" v-if="fileIcons[getFileExt(file.Key)]" />
                <IconQuestion v-else />
                <span>.{{ getFileExt(file.Key) }}</span>
              </div>
              <div class="file-manager__item-info">
                <span>{{ getFileNameWithExtension(file.Key) }}</span>
                <span>{{ formatSizeMb(file.Size) }}</span>

                <div class="file-manager__options file-manager__options_small">
                  <div @click.stop="downloadFile(file.Key)">
                    <IconDownload />
                  </div>
                  <IconTrash v-if="false" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="file-manager__video">
        <div class="file-manager__input">
          <textarea v-model="videoCode" rows="8" placeholder="Вставьте код" />
        </div>
      </div>
    </template>
    <button class="file-manager__button" @click="setFile">Вставить</button>
  </div>
</template>

<style scoped lang="scss">
.file-manager {
  width: 586px;
  height: 436px;
  @include flex(cn);

  @media (max-width: $screen-mobile-l) {
    width: 100%;
    height: 524px;
  }

  &__header {
    padding: 0 24px 24px;
    @include flex(cn);
    gap: 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__header-top {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__header-logo {
    width: 48px;
    height: 48px;
    @include flex(center);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);

    svg {
      width: 18px;
      height: 18px;
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__header-info {
    @include flex(cn);
    gap: 4px;
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);

    span {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__header-selectors {
    @include flex(rn, a-center);
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__header-selector {
    @include flex(rn, a-center);
    gap: 4px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    border-bottom: 1px solid transparent;
    padding: 4px 0;

    @media (max-width: $screen-mobile-l) {
      padding: 10px 8px;
    }

    svg {
      width: 16px;
      height: 16px;
      stroke: var(--light-text-backgroung-primary-50);
    }

    &_active {
      color: var(--light-text-backgroung-primary);
      cursor: default;
      border-color: var(--primary);

      svg {
        stroke: var(--light-text-backgroung-primary);
      }
    }
  }

  &__video {
    padding: 24px 24px 0;
    height: 100%;
  }

  &__input {
    height: 100%;

    textarea {
      padding: 8px 12px;
      width: 100%;
      height: 100%;
      border-radius: 8px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      background-color: transparent;
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary);

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__items-wrapper {
    overflow: auto;
    height: 100%;
    padding-top: 24px;
  }

  &__items {
    padding: 0 24px;
    grid-auto-rows: 1fr;
    display: grid;
    grid-auto-rows: 1fr;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;

    @media (max-width: $screen-mobile-l) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &_file {
      grid-template-columns: repeat(2, minmax(0, 1fr));

      @media (max-width: $screen-mobile-l) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }

  &__item {
    @include flex(cn);
    gap: 10px;
    padding: 8px;
    height: 122px;
    border-radius: 8px;
    cursor: pointer;
    background-color: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    backdrop-filter: blur(12px);
    border: 1px solid transparent;
    position: relative;

    &:hover {
      .file-manager__options {
        opacity: 1;
      }
    }

    &_active {
      background-color: var(--light-text-backgroung-primary-10);
      border-color: var(--primary-50);
    }

    & > img,
    & > video {
      border-radius: 8px;
      height: 100%;
      width: 100%;
      object-fit: cover;
    }

    &_input {
      gap: 8px;
      align-items: center;
      justify-content: center;
      text-align: center;
      cursor: pointer;
      border: 1px solid var(--light-text-backgroung-primary-10);
      background: unset;
      @extend %text-xs-regular;

      svg {
        width: 18px;
        height: 18px;
        stroke: var(--white-100);
      }
    }

    &_small {
      height: fit-content;
      @extend %text-s-medium;
      padding: 0;
    }

    &_small-input {
      flex-direction: row;
      gap: 4px;
      height: fit-content;
      white-space: nowrap;
      padding: 15px 16px;

      svg {
        width: 16px;
        height: 16px;
      }
    }
  }

  &__item-file {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__item-file-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    @include flex(cn, center);
    background-color: var(--divider);
    overflow: hidden;

    svg {
      width: 20px;
      height: 20px;
      stroke: var(--light-text-backgroung-primary);
    }

    span {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary);
      width: 100%;
      display: -webkit-box;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      line-clamp: 1;
      text-align: center;
    }
  }

  &__item-info {
    @include flex(cn);
    overflow: hidden;
    flex: 1;

    @media (max-width: $screen-mobile-l) {
      padding-right: 36px;
    }

    span {
      &:first-child {
        @extend %text-s-medium;
        color: var(--light-text-backgroung-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:nth-child(2) {
        @extend %text-xs-regular;
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__options {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    @include flex(cn);
    gap: 4px;
    padding: 4px 2px;
    border-radius: 4px;
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
    opacity: 0;
    transition: opacity 0.2s ease-in-out;

    @media (max-width: $screen-mobile-l) {
      opacity: 1;
    }

    &_small {
      flex-direction: row;
      background: unset;
      backdrop-filter: unset;
      right: 16px;
      bottom: 6px;
      top: unset;
      transform: unset;
      padding: 0;

      @media (max-width: $screen-mobile-l) {
        bottom: unset;
        top: 50%;
        transform: translateY(-50%);
      }

      svg {
        width: 16px;
        height: 16px;

        @media (max-width: $screen-mobile-l) {
          width: 20px;
          height: 20px;
        }
      }
    }

    div {
      display: flex;
      cursor: pointer;
    }
  }

  &__button {
    @include flex(center);
    margin-top: 8px;
    margin-left: 24px;
    margin-right: 24px;
    padding: 10px 12px;
  }
}
</style>
