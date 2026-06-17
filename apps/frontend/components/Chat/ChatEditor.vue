<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, VueNodeViewRenderer } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention from '@tiptap/extension-mention';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import { Markdown } from '@tiptap/markdown';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Table } from '~/utils/tiptap/table';
import { Image } from '~/utils/tiptap/image';
import { Iframe } from '~/utils/tiptap/iframe';
import { Video } from '~/utils/tiptap/video';
import { FileInlineNode } from '~/utils/tiptap/files';
import { AudioMessage } from '~/utils/tiptap/audio';
import suggestion from '~/utils/tiptap/suggestion';
import emojiSuggestion from '~/utils/tiptap/emojiSuggestion';
import { looksLikeMarkdown, wrapBareTextNodes } from '~/utils/tiptap/markdown';
import { hasTiptapContent } from '~/utils/tiptap/content';
import {
  createImageUploadId,
  insertImageUploadPlaceholder,
  removeImageUploadPlaceholder,
  replaceImageUploadPlaceholder,
} from '~/utils/tiptap/imageUploadPlaceholder';
import CodeBlock from '~/components/TipTap/CodeBlock.vue';
import EmojiPicker from '~/components/TipTap/EmojiPicker.vue';
import BaseModal from '~/components/BaseModal.vue';
import BaseFileManager from '~/components/BaseFileManager.vue';
import IconMic from '~/components/Icons/IconMic.vue';
import IconBold from '~/components/Icons/IconBold.vue';
import IconItalic from '~/components/Icons/IconItalic.vue';
import IconUnderline from '~/components/Icons/IconUnderline.vue';
import IconCode from '~/components/Icons/IconCode.vue';
import IconAddFile from '~/components/Icons/IconAddFile.vue';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';

const config = useRuntimeConfig();
const AWS_ENDPOINT = config.public.AWS_ENDPOINT;
const { $toast } = useNuxtApp();
const filesStore = useFilesStore();
const route = useRoute();

const lowlight = createLowlight(common);

const emit = defineEmits<{
  (e: 'update:modelValue', payload: JSONContent): void;
  (e: 'enter' | 'send' | 'mic'): void;
}>();

const props = defineProps<{
  value: JSONContent;
  modelValue?: JSONContent;
  isEditable: boolean;
  placeholder?: string;
  showMic?: boolean;
  filePrefix?: string;
}>();

const isEmojiPickerOpen = ref(false);
const fileManagerModal = ref<InstanceType<typeof BaseModal> | null>(null);

const prefix = computed(() => {
  if (props.filePrefix) return props.filePrefix;
  const val = route.query.chatId;
  const chatId = Array.isArray(val) ? val[0] : val;
  return `tracker-chat/${chatId}/`;
});

const imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const maxSize = 1024 * 1024 * 1024;
const pendingUploadCount = ref(0);
const hasPendingUploads = computed(() => pendingUploadCount.value > 0);

const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('prefix', prefix.value);
  return filesStore.addFile(formData);
};

const insertFileByKey = (currentEditor: Editor, key: string) => {
  const href = buildAwsObjectUrl(key, AWS_ENDPOINT) ?? key;
  const raw = key.split('/').pop() || key;
  const dot = raw.lastIndexOf('.');
  const name = dot > -1 ? raw.slice(0, dot) : raw;
  const ext = dot > -1 ? raw.slice(dot + 1) : '';
  const pos = currentEditor.state.selection.to;
  currentEditor
    .chain()
    .focus()
    .insertContentAt(pos, { type: 'fileInline', attrs: { href, name, ext } })
    .insertContentAt(pos + 1, ' ')
    .run();
};

const insertImageFile = async (currentEditor: Editor, file: File) => {
  const uploadId = createImageUploadId();
  const previewSrc = URL.createObjectURL(file);
  insertImageUploadPlaceholder(currentEditor, uploadId, file.name, previewSrc);
  pendingUploadCount.value += 1;
  let isPlaceholderReplaced = false;

  try {
    const response = await uploadFile(file);
    isPlaceholderReplaced = replaceImageUploadPlaceholder(currentEditor, uploadId, response.Key);
  } finally {
    if (!isPlaceholderReplaced) removeImageUploadPlaceholder(currentEditor, uploadId);
    URL.revokeObjectURL(previewSrc);
    pendingUploadCount.value = Math.max(0, pendingUploadCount.value - 1);
  }
};

const insertFiles = async (currentEditor: Editor, files: File[]) => {
  for (const file of files) {
    try {
      if (file.size > maxSize) {
        $toast.error(`Максимальный размер: ${maxSize / 1024 / 1024 / 1024} ГБ`);
        continue;
      }
      if (file.size === 0) {
        $toast.error('Файл пуст. Выберите другой файл');
        continue;
      }
      if (file.type.startsWith('image/')) {
        if (!imageMimeTypes.includes(file.type)) {
          $toast.error('Неподдерживаемый формат изображения');
          continue;
        }
        await insertImageFile(currentEditor, file);
        continue;
      }
      const response = await uploadFile(file);
      insertFileByKey(currentEditor, response.Key);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    }
  }
};

const guardPendingUploads = () => {
  if (!hasPendingUploads.value) return false;
  $toast.warning('Дождитесь загрузки изображения');
  return true;
};

const emitEnter = () => {
  if (guardPendingUploads()) return;
  emit('enter');
};

const emitSend = () => {
  if (guardPendingUploads()) return;
  emit('send');
};

const editor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    Placeholder.configure({ placeholder: props.placeholder || 'Напишите...' }),
    Image.configure({ awsEndpoint: config.public.AWS_ENDPOINT, inline: false }),
    Iframe,
    Video,
    FileInlineNode,
    AudioMessage,
    CodeBlockLowlight.extend({
      addNodeView() {
        return VueNodeViewRenderer(CodeBlock);
      },
    }).configure({ lowlight, defaultLanguage: 'typescript' }),
    TaskItem,
    TaskList,
    Mention.configure({ HTMLAttributes: { class: 'mention' }, suggestion }),
    Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true, suggestion: emojiSuggestion }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true, pedantic: false } }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ],
  content: props.modelValue,
  editable: props.isEditable,
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getJSON());
  },
  editorProps: {
    handlePaste: (_view, event) => {
      if (!editor.value) return false;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) {
        event.preventDefault();
        void insertFiles(editor.value, files);
        return true;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text && looksLikeMarkdown(text)) {
        try {
          const manager = editor.value.storage.markdown?.manager;
          if (manager) {
            const content = wrapBareTextNodes(manager.parse(text).content ?? []);
            if (content.length > 0) {
              event.preventDefault();
              editor.value.chain().focus().insertContent(content).run();
              return true;
            }
          }
        } catch {
          return false;
        }
      }
      return false;
    },
    handleDrop: (_view, event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length || !editor.value) return false;
      event.preventDefault();
      void insertFiles(editor.value, files);
      return true;
    },
    handleDOMEvents: {
      keydown: (_view, event: KeyboardEvent) => {
        if (event.key === 'Enter' && event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          emitEnter();
          return true;
        }
      },
    },
  },
});

watch(
  () => props.isEditable,
  (newVal) => {
    editor.value?.setEditable(newVal);
  },
);

const focusEditor = () => {
  editor.value?.chain().focus().run();
};
const clearContent = () => {
  editor.value?.commands.clearContent(true);
};

defineExpose({ focusEditor, clearContent });

const insertEmoji = (emoji: string) => {
  if (!editor.value) return;
  editor.value.chain().focus().insertContent(emoji).run();
  isEmojiPickerOpen.value = false;
};

const openFileManager = () => {
  filesStore.fetchFiles(prefix.value);
  fileManagerModal.value?.open();
};

const insertImage = (file: string) => {
  if (!file || !editor.value) return;
  editor.value.chain().focus().setImage({ src: file, width: '200' }).run();
  fileManagerModal.value?.close();
};

const insertVideo = (file: string) => {
  if (!file || !editor.value) return;
  const { to } = editor.value.state.selection;
  editor.value
    .chain()
    .focus()
    .insertContentAt(to, { type: 'paragraph' })
    .insertContentAt(to + 1, {
      type: 'video',
      attrs: { src: buildAwsObjectUrl(file, AWS_ENDPOINT) ?? file, width: '100%', controls: true },
    })
    .run();
  fileManagerModal.value?.close();
};

const insertCode = (code: string) => {
  if (!editor.value) return;
  const iframeEl = new DOMParser().parseFromString(code, 'text/html').querySelector('iframe');
  if (iframeEl) {
    editor.value
      .chain()
      .focus()
      .insertContent({
        type: 'iframe',
        attrs: {
          src: iframeEl.getAttribute('src'),
          width: iframeEl.getAttribute('width'),
          height: iframeEl.getAttribute('height'),
          frameborder: iframeEl.getAttribute('frameborder'),
          allowfullscreen: iframeEl.hasAttribute('allowfullscreen'),
        },
      })
      .run();
  }
  fileManagerModal.value?.close();
};

const insertFile = (key: string) => {
  if (!key || !editor.value) return;
  insertFileByKey(editor.value, key);
  fileManagerModal.value?.close();
};

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <client-only>
    <div v-if="editor" class="chat-editor">
      <editor-content :editor="editor" class="chat-editor__content" />
      <div class="chat-editor__bottom">
        <div class="chat-editor__toolbar">
          <button
            class="chat-editor__tool-btn"
            :class="{ 'chat-editor__tool-btn_active': editor.isActive('bold') }"
            @click="editor.chain().focus().toggleBold().run()"
          >
            <IconBold />
          </button>
          <button
            class="chat-editor__tool-btn"
            :class="{ 'chat-editor__tool-btn_active': editor.isActive('italic') }"
            @click="editor.chain().focus().toggleItalic().run()"
          >
            <IconItalic />
          </button>
          <button
            class="chat-editor__tool-btn"
            :class="{ 'chat-editor__tool-btn_active': editor.isActive('underline') }"
            @click="editor.chain().focus().toggleUnderline().run()"
          >
            <IconUnderline />
          </button>
          <div class="chat-editor__divider" />
          <button
            class="chat-editor__tool-btn"
            :class="{ 'chat-editor__tool-btn_active': editor.isActive('codeBlock') }"
            @click="editor.chain().focus().toggleCodeBlock().run()"
          >
            <IconCode />
          </button>
          <button class="chat-editor__tool-btn" title="Прикрепить файл" @click="openFileManager">
            <IconAddFile />
          </button>
        </div>
        <div class="chat-editor__actions">
          <div v-click-outside="() => (isEmojiPickerOpen = false)" class="chat-editor__emoji-wrap">
            <button class="chat-editor__emoji-btn" title="Смайлики" @click="isEmojiPickerOpen = !isEmojiPickerOpen">😊</button>
            <Transition name="chat-emoji-pop">
              <EmojiPicker v-if="isEmojiPickerOpen" class="chat-editor__emoji-picker" @select="insertEmoji" />
            </Transition>
          </div>
          <button
            v-if="hasTiptapContent(value)"
            class="chat-editor__send-btn"
            :disabled="hasPendingUploads"
            :title="hasPendingUploads ? 'Дождитесь загрузки изображения' : 'Отправить'"
            @click="emitSend"
          >
            <span class="chat-editor__send-text">{{ hasPendingUploads ? 'Загрузка...' : 'Отправить' }}</span>
            <svg class="chat-editor__send-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M3 9h12M10 4l5 5-5 5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button v-else-if="showMic" class="chat-editor__mic-btn" title="Голосовое сообщение" @click="emit('mic')">
            <IconMic />
          </button>
        </div>
      </div>
    </div>
  </client-only>
  <teleport to="#teleports">
    <BaseModal ref="fileManagerModal" class="chat-file-manager-modal">
      <BaseFileManager
        @insert-img="insertImage"
        @insert-video="insertVideo"
        @insert-code="insertCode"
        @insert-file="insertFile"
      />
    </BaseModal>
  </teleport>
</template>

<style scoped lang="scss">
.chat-file-manager-modal {
  :deep(.base-modal__content) {
    width: auto;

    @media (max-width: $screen-mobile-l) {
      width: 100%;
    }
  }
}
</style>

<style lang="scss">
.chat-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &__content {
    .tiptap {
      font-size: 16px;
      line-height: 1.5;
      width: 100%;
      word-break: break-word;
      color: var(--light-text-backgroung-primary);
      min-height: 24px;
      max-height: 300px;
      overflow-y: auto;

      p {
        min-height: 1em;
        margin: 0;
      }

      p:empty::before {
        content: '\A';
        white-space: pre;
      }

      p.is-editor-empty:first-child::before {
        color: var(--white-50);
        content: attr(data-placeholder);
        float: left;
        height: 0;
        pointer-events: none;
      }

      &:focus-visible {
        outline: none;
      }

      .mention {
        background-color: var(--primary-50);
        border-radius: 1000px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 8px;
        width: fit-content;
        color: var(--light-text-backgroung-primary);
      }

      .file-inline {
        display: inline-flex;
        align-items: center;
        gap: 4px;

        svg {
          width: 20px;
          height: 20px;
        }
      }

      pre {
        padding: 8px;
        border-radius: 0 8px 8px 0;
        border-left: 1px solid var(--light-text-backgroung-primary-50);
        background: var(--light-text-backgroung-primary-5);
        overflow: auto;
      }
    }
  }

  &__bottom {
    display: flex;
    align-items: center;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    padding-top: 4px;
    gap: 4px;
  }

  &__toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__divider {
    width: 1px;
    height: 20px;
    background-color: var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__tool-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;

    svg {
      stroke: var(--light-text-backgroung-primary);
    }

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_active {
      background: var(--primary);

      &:hover {
        background: var(--primary);
      }
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    position: relative;
  }

  &__emoji-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  &__emoji-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--light-text-backgroung-primary-10);
    }
  }

  &__emoji-picker {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 100;

    @media (max-width: $screen-mobile-l) {
      position: fixed;
      bottom: 80px;
      right: 8px;
      left: 8px;
      width: auto;
    }
  }

  &__send-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    height: 40px;
    border-radius: 8px;
    background: var(--primary-dark);
    color: var(--white-100);
    @extend %text-s-medium;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      background: var(--primary);
    }

    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    svg {
      stroke: currentColor;
      flex-shrink: 0;
    }

    .chat-editor__send-icon {
      display: none;
    }

    @media (max-width: $screen-mobile-l) {
      padding: 0;
      width: 40px;
      justify-content: center;

      .chat-editor__send-text {
        display: none;
      }

      .chat-editor__send-icon {
        display: block;
      }
    }
  }

  &__mic-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--primary-dark);
    color: var(--white-100);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease;

    &:hover {
      background: var(--primary);
    }

    svg {
      display: block;
      width: 18px;
      height: 18px;
      stroke: currentColor;
    }
  }
}

.chat-emoji-pop-enter-active,
.chat-emoji-pop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.chat-emoji-pop-enter-from,
.chat-emoji-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}
</style>
