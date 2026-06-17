<script setup lang="ts">
import { computed, ref } from 'vue';
import type { JSONContent } from '@tiptap/core';
import { generateHTML } from '@tiptap/html';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import ChatAudioPlayer from '~/components/Chat/ChatAudioPlayer.vue';
import { getTiptapRenderExtensions, docHasInteractiveNodes } from '~/utils/tiptap/renderExtensions';

const props = defineProps<{ value: JSONContent | null | undefined }>();

const config = useRuntimeConfig();

// Клик по картинке в сообщении → просмотр на весь экран (в статике нет NodeView, делаем сами)
const isImageOpen = ref(false);
const modalImageUrl = ref('');
const onContentClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.tagName !== 'IMG' || target.closest('[data-type="emoji"]')) return;
  const img = target as HTMLImageElement;
  modalImageUrl.value = img.currentSrc || img.getAttribute('src') || '';
  isImageOpen.value = true;
};

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
// Значение для fallback-редактора (срабатывает только при непустом value, но TS этого не знает)
const editorValue = computed<JSONContent>(() => props.value ?? EMPTY_DOC);

const isEmpty = computed(() => {
  const content = props.value?.content;
  return !Array.isArray(content) || content.length === 0;
});

// Голосовое сообщение = doc, состоящий только из узлов audioMessage.
// Такие рендерим напрямую кастомным плеером (SSR + гидратация, без редактора и без мерцания).
const audioNodes = computed<JSONContent[]>(() => {
  const content = props.value?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((node) => node?.type === 'audioMessage');
});
const isAudioMessage = computed(() => {
  const content = props.value?.content;
  return Array.isArray(content) && content.length > 0 && content.every((node) => node?.type === 'audioMessage');
});

/**
 * Готовый HTML сообщения. null => рендерим через read-only EditorTiptap
 * (интерактивные ноды вроде голосовых, либо сбой генерации).
 * Пустое сообщение => пустая строка (просто пустой блок).
 * generateHTML детерминирован и одинаков на сервере и клиенте — поэтому нет hydration mismatch.
 */
const html = computed<string | null>(() => {
  if (!props.value || isEmpty.value) return '';
  if (docHasInteractiveNodes(props.value)) return null;
  try {
    return generateHTML(props.value, getTiptapRenderExtensions(config.public.AWS_ENDPOINT as string | undefined));
  } catch (e) {
    console.error('MessageContent: статический рендер не удался, fallback на редактор', e);
    return null;
  }
});
</script>

<template>
  <!-- Голосовое: кастомный плеер напрямую, рендерится сразу (SSR), без мерцания -->
  <template v-if="isAudioMessage">
    <ChatAudioPlayer
      v-for="(node, i) in audioNodes"
      :key="i"
      :src="(node.attrs?.src as string) || ''"
      :duration="(node.attrs?.duration as number) || 0"
    />
  </template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else-if="html !== null" class="message-content" @click="onContentClick" v-html="html" />
  <!-- Прочие интерактивные ноды (видео/файлы) рендерим только на клиенте, без SSR -->
  <ClientOnly v-else>
    <EditorTiptap :value="editorValue" :model-value="editorValue" :is-editable="false" />
  </ClientOnly>

  <!-- Просмотр картинок на весь экран; интерактивно — только на клиенте -->
  <ClientOnly>
    <Teleport to="body">
      <div v-if="isImageOpen" class="message-image-viewer" @click="isImageOpen = false">
        <img :src="modalImageUrl" alt="" />
        <button class="message-image-viewer__close" type="button" aria-label="Закрыть" @click="isImageOpen = false">
          ✕
        </button>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<style scoped lang="scss">
.message-content {
  word-break: break-word;
  overflow-wrap: anywhere;

  :deep(p) {
    margin: 0;
  }

  :deep(p + p),
  :deep(ul),
  :deep(ol),
  :deep(blockquote),
  :deep(pre) {
    margin-top: 4px;
  }

  :deep(a) {
    color: var(--primary);
    text-decoration: underline;
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    cursor: zoom-in;
  }

  // Эмодзи — это inline-картинки, их нельзя растягивать как обычные изображения
  :deep([data-type='emoji']) img,
  :deep(img[alt$='emoji']) {
    display: inline-block;
    width: 1.25em;
    height: 1.25em;
    margin: 0;
    border-radius: 0;
    vertical-align: -0.2em;
    cursor: text;
  }

  :deep(ul),
  :deep(ol) {
    margin-bottom: 0;
    padding-left: 18px;
  }

  :deep(pre) {
    overflow-x: auto;
    padding: 8px 10px;
    border-radius: 8px;
    background-color: var(--primary-50);

    code {
      white-space: pre;
    }
  }

  :deep(code) {
    padding: 1px 4px;
    border-radius: 4px;
    background-color: var(--primary-50);
  }

  :deep(blockquote) {
    padding-left: 10px;
    border-left: 3px solid var(--primary-50);
  }

  :deep(.mention) {
    background-color: var(--primary-50);
    border-radius: 1000px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    @extend %text-xs-regular;
    box-decoration-break: clone;
    width: fit-content;
    color: var(--light-text-backgroung-primary);
    padding: 2px 8px;
  }
}

.message-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background-color: var(--black-85);
  cursor: zoom-out;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  &__close {
    position: absolute;
    top: 16px;
    right: 20px;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background-color: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--light-text-backgroung-primary-25);
    }
  }
}
</style>
