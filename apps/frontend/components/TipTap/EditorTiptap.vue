<script setup lang="ts">
import { nextTick, onBeforeUnmount } from 'vue';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, VueNodeViewRenderer } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Image } from '~/utils/tiptap/image';
import { Table } from '~/utils/tiptap/table';
import BaseFileManager from '~/components/BaseFileManager.vue';
import BaseModal from '~/components/BaseModal.vue';
import BaseImageModal from '~/components/BaseImageModal.vue';
import { Iframe } from '~/utils/tiptap/iframe';
import { Video } from '~/utils/tiptap/video';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import 'highlight.js/styles/atom-one-dark.css';
import CodeBlock from '~/components/TipTap/CodeBlock.vue';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention from '@tiptap/extension-mention';
import suggestion from '~/utils/tiptap/suggestion';
import { FileInlineNode } from '~/utils/tiptap/files';
import { AudioMessage } from '~/utils/tiptap/audio';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import emojiSuggestion from '~/utils/tiptap/emojiSuggestion';
import EditorMenu from './EditorMenu.vue';
import EmojiPicker from './EmojiPicker.vue';
import IconMic from '~/components/Icons/IconMic.vue';
import IconButtonLoader from '../Icons/IconButtonLoader.vue';
import IconGenerate from '../Icons/IconGenerate.vue';
import { hasTiptapContent } from '~/utils/tiptap/content';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';
import { Markdown } from '@tiptap/markdown';
import {
  createImageUploadId,
  insertImageUploadPlaceholder,
  removeImageUploadPlaceholder,
  replaceImageUploadPlaceholder,
} from '~/utils/tiptap/imageUploadPlaceholder';
import {
  downloadMarkdown,
  readFileAsText,
  looksLikeMarkdown,
  looksLikeCodeEditorHtml,
  wrapBareTextNodes,
} from '~/utils/tiptap/markdown';

const config = useRuntimeConfig();

const lowlight = createLowlight(common);
lowlight.register({ javascript, typescript });

const emit = defineEmits<{
  (e: 'update:modelValue', payload: JSONContent): void;
  (e: 'open-image-modal' | 'enter' | 'send' | 'mic'): void;
  (e: 'generate-description', instruction?: string): void;
}>();

const props = defineProps<{
  value: JSONContent;
  modelValue?: JSONContent;
  isEditable: boolean;
  placeholder?: string;
  descriptionCreate?: boolean;
  generateButton?: boolean;
  isGeneratingDescription?: boolean;
  shortMenu?: boolean;
  showMic?: boolean;
  filePrefix?: string;
}>();
const { $toast } = useNuxtApp();
const AWS_ENDPOINT = config.public.AWS_ENDPOINT;

type FileManagerMode = 'image' | 'video' | 'file';
type FileInsertSource = 'clipboard' | 'drop';

const fileManagerMode = ref<FileManagerMode>('image');
const isEmojiPickerOpen = ref(false);
const showGenerateInput = ref(false);
const generateInstruction = ref('');
const generateInputRef = ref<HTMLInputElement | null>(null);
const pendingUploadCount = ref(0);
const hasPendingUploads = computed(() => pendingUploadCount.value > 0);

const openGenerateInput = async () => {
  showGenerateInput.value = true;
  await nextTick();
  generateInputRef.value?.focus();
};

const cancelGenerateInput = () => {
  showGenerateInput.value = false;
  generateInstruction.value = '';
};

const submitGenerate = () => {
  const instr = generateInstruction.value.trim() || undefined;
  showGenerateInput.value = false;
  generateInstruction.value = '';
  emit('generate-description', instr);
};

const insertEmoji = (emoji: string) => {
  if (!editor.value) return;
  editor.value.chain().focus().insertContent(emoji).run();
  isEmojiPickerOpen.value = false;
};
const wikiStore = useWikiStore();
const filesStore = useFilesStore();
const route = useRoute();

const currentTaskId = computed<number | null>(() => {
  const q = route.query['task-id'];
  if (!q) return null;
  const val = Array.isArray(q) ? q[0] : q;
  const n = Number(val);
  return Number.isInteger(n) ? n : null;
});

const addTable = () => {
  if (!editor.value) return;
  editor.value.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
};

const addImage = ({ src, width }: { src: string; width: string }) => {
  if (!editor.value) return;
  const { to } = editor.value.state.selection;
  editor.value
    .chain()
    .focus()
    .insertContentAt(to, {
      type: 'paragraph',
    })
    .insertContentAt(to + 1, {
      type: 'image',
      attrs: {
        src,
        width,
      },
    })
    .run();
};

const currentWikiProjectId = computed<number | null>(() => {
  const q = route.query.project_id;
  const val = Array.isArray(q) ? q[0] : q;
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : wikiStore.selectedProjectId;
});

const prefix = computed(() => {
  if (props.filePrefix) return props.filePrefix;
  if (wikiStore.currentPage && currentWikiProjectId.value) {
    return `tracker-project-wiki/${currentWikiProjectId.value}/`;
  }
  if (route.query.chatId) {
    const val = Array.isArray(route.query.chatId) ? route.query.chatId[0] : route.query.chatId;
    return `tracker-chat/${val}/`;
  }
  return `tracker-tasks/${currentTaskId.value}/`;
});

const imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const maxSize = 1024 * 1024 * 1024;

const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('prefix', prefix.value);
  return filesStore.addFile(formData);
};

const createUniqueFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex > -1 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > -1 ? fileName.slice(dotIndex) : '';
  const uniqueSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${baseName}-${uniqueSuffix}${extension}`;
};

const shouldUniqueClipboardImage = (file: File, source: FileInsertSource) => {
  return source === 'clipboard' && file.name.toLowerCase() === 'image.png';
};

const insertImageFile = async (currentEditor: Editor, file: File, source: FileInsertSource) => {
  const fileToUpload = shouldUniqueClipboardImage(file, source)
    ? new File([file], createUniqueFileName(file.name), {
        type: file.type,
        lastModified: file.lastModified,
      })
    : file;
  const uploadId = createImageUploadId();
  const previewSrc = URL.createObjectURL(file);
  insertImageUploadPlaceholder(currentEditor, uploadId, file.name, previewSrc);
  pendingUploadCount.value += 1;
  let isPlaceholderReplaced = false;

  try {
    const response = await uploadFile(fileToUpload);
    isPlaceholderReplaced = replaceImageUploadPlaceholder(currentEditor, uploadId, response.Key);
  } finally {
    if (!isPlaceholderReplaced) removeImageUploadPlaceholder(currentEditor, uploadId);
    URL.revokeObjectURL(previewSrc);
    pendingUploadCount.value = Math.max(0, pendingUploadCount.value - 1);
  }
};

const insertVideoFile = async (currentEditor: Editor, file: File) => {
  const response = await uploadFile(file);
  const { to } = currentEditor.state.selection;
  currentEditor
    .chain()
    .focus()
    .insertContentAt(to, {
      type: 'paragraph',
    })
    .insertContentAt(to + 1, {
      type: 'video',
      attrs: {
        src: buildAwsObjectUrl(response.Key, AWS_ENDPOINT) ?? response.Key,
        width: '100%',
        height: 'auto',
        controls: true,
      },
    })
    .run();
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

const insertFileAttachment = async (currentEditor: Editor, file: File) => {
  const response = await uploadFile(file);
  insertFileByKey(currentEditor, response.Key);
};

const insertFiles = async (currentEditor: Editor, files: File[], source: FileInsertSource) => {
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
        await insertImageFile(currentEditor, file, source);
        continue;
      }
      if (file.type.startsWith('video/')) {
        await insertVideoFile(currentEditor, file);
        continue;
      }
      await insertFileAttachment(currentEditor, file);
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

const tiptapExtensions = [
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  StarterKit.configure({ codeBlock: false }),
  Placeholder.configure({ placeholder: props.placeholder || 'Напишите...' }),
  Table.configure({ resizable: true }),
  TableRow,
  TableCell,
  TableHeader,
  Image.configure({
    awsEndpoint: config.public.AWS_ENDPOINT,
    inline: false,
  }),
  Iframe,
  Video,
  FileInlineNode,
  AudioMessage,
  CodeBlockLowlight.extend({
    addNodeView() {
      return VueNodeViewRenderer(CodeBlock);
    },
  }).configure({
    lowlight,
    defaultLanguage: 'typescript',
    languageClassPrefix: 'language-',
  }),
  TaskItem,
  TaskList,
  Mention.configure({
    HTMLAttributes: {
      class: 'mention',
    },
    suggestion,
  }),
  Emoji.configure({
    emojis: gitHubEmojis,
    enableEmoticons: true,
    suggestion: emojiSuggestion,
  }),
  Markdown.configure({
    markedOptions: {
      gfm: true,
      breaks: true,
      pedantic: false,
    },
  }),
];

const editor = useEditor({
  extensions: tiptapExtensions,
  content: props.modelValue,
  editable: props.isEditable,
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getJSON());
  },
  editorProps: {
    transformPastedHTML: (html) => {
      if (typeof DOMParser === 'undefined') return html;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        const isExternalHttp = (src.startsWith('http://') || src.startsWith('https://')) && !src.startsWith(AWS_ENDPOINT);
        const isInlineImage = src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('file:');
        if (isExternalHttp || isInlineImage) {
          img.remove();
        }
      });
      return doc.body.innerHTML;
    },
    handlePaste: (_view, event) => {
      if (!editor.value) return false;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) {
        event.preventDefault();
        void insertFiles(editor.value, files, 'clipboard');
        return true;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const html = event.clipboardData?.getData('text/html') ?? '';
      const isInsideCodeBlock = editor.value.isActive('codeBlock');
      if (isInsideCodeBlock) return false;
      if (text && html && looksLikeCodeEditorHtml(html)) {
        event.preventDefault();
        editor.value
          .chain()
          .focus()
          .insertContent({ type: 'codeBlock', content: [{ type: 'text', text }] })
          .run();
        return true;
      }
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
      void insertFiles(editor.value, files, 'drop');
      return true;
    },
    handleDOMEvents: {
      keydown: (view, event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          const { selection, schema, doc } = view.state;
          if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
            event.preventDefault();
            event.stopPropagation();
            const depth = selection.$from.depth;
            const insertPos = depth > 0 ? selection.$from.after(depth) : selection.to;
            const paragraph = schema.nodes.paragraph?.createAndFill();
            if (!paragraph) return true;
            const safePos = Math.min(insertPos, doc.content.size);
            const tr = view.state.tr.insert(safePos, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, Math.min(safePos + 1, tr.doc.content.size)));
            view.dispatch(tr);
            return true;
          }

          if (selection.empty) {
            const { $from } = selection;
            const nodeBefore = $from.nodeBefore;
            if (nodeBefore?.type.name === 'image') {
              event.preventDefault();
              event.stopPropagation();
              const depth = $from.depth;
              const insertPos = depth > 0 ? $from.after(depth) : selection.to;
              const paragraph = schema.nodes.paragraph?.createAndFill();
              if (!paragraph) return true;
              const safePos = Math.min(insertPos, doc.content.size);
              const tr = view.state.tr.insert(safePos, paragraph);
              tr.setSelection(TextSelection.create(tr.doc, Math.min(safePos + 1, tr.doc.content.size)));
              view.dispatch(tr);
              return true;
            }
          }
        }
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
  () => props.modelValue,
  (newVal) => {
    if (editor.value && newVal && !props.isEditable) {
      editor.value.commands.setContent(newVal);
    }
  },
);

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

defineExpose({
  addTable,
  addImage,
  focusEditor,
  clearContent,
});

const fileManagerModal = ref<InstanceType<typeof BaseModal> | null>(null);
const modalImageUrl = ref('');

const insertImage = async (file: string) => {
  if (!file) return $toast.error('Не выбрано изображение');

  if (!editor.value) return;
  addImage({
    src: file,
    width: '200',
  });

  if (!fileManagerModal.value) return;
  fileManagerModal.value.close();
};

const insertVideo = async (file: string) => {
  if (!file) return $toast.error('Не выбрано видео');

  if (!editor.value) return;
  const { to } = editor.value.state.selection;

  editor.value
    .chain()
    .focus()
    .insertContentAt(to, {
      type: 'paragraph',
    })
    .insertContentAt(to + 1, {
      type: 'video',
      attrs: {
        src: buildAwsObjectUrl(file, AWS_ENDPOINT) ?? file,
        width: '100%',
        controls: true,
      },
    })
    .run();

  if (!fileManagerModal.value) return;
  fileManagerModal.value.close();
};

const openFileManagerModal = () => {
  if (!fileManagerModal.value) return;
  fileManagerModal.value.open();
};

const closeFileManagerModal = () => {
  if (!fileManagerModal.value) return;
  fileManagerModal.value.close();
};

const openImageFileManagerModal = () => {
  filesStore.fetchFiles(prefix.value);
  fileManagerMode.value = 'image';
  openFileManagerModal();
};
const openVideoFileManagerModal = () => {
  filesStore.fetchFiles(prefix.value);
  fileManagerMode.value = 'video';
  openFileManagerModal();
};
const openOtherFileManagerModal = () => {
  filesStore.fetchFiles(prefix.value);
  fileManagerMode.value = 'file';
  openFileManagerModal();
};

const markdownInput = ref<HTMLInputElement | null>(null);

const openMarkdownImport = () => {
  markdownInput.value?.click();
};

const handleMarkdownImport = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file || !editor.value) return;
  try {
    const text = await readFileAsText(file);
    const manager = editor.value.storage.markdown?.manager;
    if (!manager) {
      $toast.error('Markdown manager не инициализирован');
      return;
    }
    const content = wrapBareTextNodes(manager.parse(text).content ?? []);
    if (content.length === 0) return;
    editor.value.chain().focus().insertContent(content).run();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const exportMarkdown = () => {
  if (!editor.value) return;
  try {
    const md = editor.value.getMarkdown();
    const baseName = wikiStore.currentPage?.name || 'document';
    downloadMarkdown(md, `${baseName}.md`);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const insertCode = (code: string) => {
  if (!editor.value) return;
  const parser = new DOMParser();
  const doc = parser.parseFromString(code, 'text/html');
  const iframeEl = doc.querySelector('iframe');
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
  closeFileManagerModal();
};

const insertFile = (key: string) => {
  if (!key) return $toast.error('Файл не выбран');
  if (!editor.value) return;

  const href = buildAwsObjectUrl(key, AWS_ENDPOINT) ?? key;
  const raw = key.split('/').pop() || key;
  const dot = raw.lastIndexOf('.');
  const name = dot > -1 ? raw.slice(0, dot) : raw;
  const ext = dot > -1 ? raw.slice(dot + 1) : '';

  const pos = editor.value.state.selection.to;

  editor.value
    .chain()
    .focus()
    .insertContentAt(pos, { type: 'fileInline', attrs: { href, name, ext } })
    .insertContentAt(pos + 1, ' ')
    .run();

  fileManagerModal.value?.close();
};

onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.destroy();
  }
});
</script>

<template>
  <client-only class="editor">
    <div
      v-if="editor"
      :class="['editor', { editor_create: descriptionCreate, editor_reverse: shortMenu, editor_editable: isEditable }]"
    >
      <div v-if="isEditable" :class="['editor__top', { editor__top_short: shortMenu }]">
        <EditorMenu
          :editor="editor"
          :short-menu="shortMenu"
          @add-image="openImageFileManagerModal"
          @add-video="openVideoFileManagerModal"
          @add-file="openOtherFileManagerModal"
          @import-md="openMarkdownImport"
          @export-md="exportMarkdown"
        />
        <input ref="markdownInput" type="file" accept=".md,.markdown,text/markdown" hidden @change="handleMarkdownImport" />
        <div v-if="isEditable && generateButton" class="editor__generate-wrap">
          <span class="editor__generate" @click="showGenerateInput ? cancelGenerateInput() : openGenerateInput()">
            <IconButtonLoader v-if="isGeneratingDescription" class="btn__loader" />
            <IconGenerate v-else />
          </span>
          <Transition name="instruction-slide">
            <div v-if="showGenerateInput" class="editor__generate-input-wrap">
              <input
                ref="generateInputRef"
                v-model="generateInstruction"
                class="editor__generate-input"
                placeholder="Инструкция для ИИ..."
                @keydown.enter.prevent="submitGenerate"
                @keydown.esc="cancelGenerateInput"
              />
              <button class="editor__generate-submit" @click="submitGenerate">Применить</button>
              <button class="editor__generate-cancel" title="Отмена" @click="cancelGenerateInput">✕</button>
            </div>
          </Transition>
        </div>
        <div v-if="shortMenu" class="editor__actions">
          <div v-click-outside="() => (isEmojiPickerOpen = false)" class="editor__emoji-wrap">
            <button class="editor__emoji-btn" title="Смайлики" @click="isEmojiPickerOpen = !isEmojiPickerOpen">😊</button>
            <Transition name="emoji-pop">
              <EmojiPicker v-if="isEmojiPickerOpen" class="editor__emoji-picker" @select="insertEmoji" />
            </Transition>
          </div>
          <button
            v-if="hasTiptapContent(value)"
            class="editor__send-btn"
            :disabled="hasPendingUploads"
            :title="hasPendingUploads ? 'Дождитесь загрузки изображения' : 'Отправить'"
            @click="emitSend"
          >
            <span class="editor__send-btn-text">{{ hasPendingUploads ? 'Загрузка...' : 'Отправить' }}</span>
            <svg class="editor__send-btn-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <button v-else-if="showMic" class="editor__mic-btn" title="Голосовое сообщение" @click="emit('mic')">
            <IconMic />
          </button>
        </div>
      </div>
      <editor-content :editor="editor" />
    </div>
  </client-only>
  <teleport to="#teleports">
    <BaseModal ref="fileManagerModal" class="file-manager-modal">
      <BaseFileManager
        :mode="fileManagerMode"
        @insert-code="insertCode"
        @insert-img="insertImage"
        @insert-video="insertVideo"
        @insert-file="insertFile"
      />
    </BaseModal>
    <BaseImageModal v-if="!editor?.isEditable" ref="imageModal">
      <div class="image-modal">
        <img :src="modalImageUrl" alt="" />
      </div>
    </BaseImageModal>
  </teleport>
</template>

<style scoped lang="scss">
.file-manager-modal {
  :deep(.base-modal__content) {
    width: auto;

    @media (max-width: $screen-mobile-l) {
      width: 100%;
    }
  }
}

.image-modal {
  border-radius: 16px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 16px;
  }

  @media (max-width: $screen-mobile-l) {
    width: 100%;
    height: fit-content;
  }
}
</style>

<style lang="scss">
.editor {
  @include flex(cn);
  gap: 12px;
  width: 100%;

  &_create {
    margin-right: 30px;
  }

  &_reverse {
    flex-direction: column-reverse;

    .tiptap {
      font-size: 16px;
      line-height: 1.5;
    }

    :deep(.editor-menu__item) {
      width: 32px;
      height: 32px;
      border-radius: 6px;
    }
  }

  &__top {
    @include flex(rn, a-start, between);
    gap: 4px;

    &_short {
      align-items: center;
      border-top: 1px solid var(--light-text-backgroung-primary-10);
      padding-top: 4px;
    }
  }

  &_editable {
    pre {
      min-height: 50px;
    }
  }

  &__generate {
    cursor: pointer;
    @include flex(center);
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  &__generate-wrap {
    position: relative;
    flex-shrink: 0;
  }

  &__generate-input-wrap {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    @include flex(rn, a-center);
    gap: 6px;
    z-index: 200;
    background: var(--light-bg-primary, var(--dark-text-background-secondary));
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 4px 6px;
    box-shadow: 0 4px 16px var(--black-40);
    white-space: nowrap;
  }

  &__generate-input {
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-bg-secondary, var(--dark-text-background-secondary));
    color: var(--light-text-primary);
    @extend %text-xs-regular;
    width: 200px;
    outline: none;

    &:focus {
      border-color: var(--primary);
    }

    &::placeholder {
      color: var(--light-text-secondary, #888);
    }
  }

  &__generate-submit {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-regular;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.85;
    }
  }

  &__generate-cancel {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    @extend %text-xs-regular;
    color: var(--light-text-secondary, #888);
    cursor: pointer;
    @include flex(center);
    transition: color 0.15s;

    &:hover {
      color: var(--danger-delete);
    }
  }

  .instruction-slide-enter-active,
  .instruction-slide-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .instruction-slide-enter-from,
  .instruction-slide-leave-to {
    opacity: 0;
    transform: translateX(6px);
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 4px;
    flex-shrink: 0;
    position: relative;
  }

  &__send-btn {
    @include flex(rn, a-center);
    gap: 6px;
    padding: 0 14px;
    height: 40px;
    border-radius: 8px;
    background: var(--primary-dark);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      background: var(--primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    svg {
      stroke: currentColor;
      flex-shrink: 0;
    }

    &-icon {
      display: none;
    }

    @media (max-width: $screen-mobile-l) {
      padding: 0;
      width: 40px;
      justify-content: center;

      &-text {
        display: none;
      }

      &-icon {
        display: block;
      }
    }
  }

  &__mic-btn {
    @include flex(center);
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--primary-dark);
    color: var(--light-text-backgroung-primary);
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

  &__emoji-wrap {
    position: relative;
    @include flex(rn, a-center);
  }

  &__emoji-btn {
    @include flex(center);
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    color: var(--light-text-backgroung-primary-50);
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
}


.emoji-pop-enter-active,
.emoji-pop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.emoji-pop-enter-from,
.emoji-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}

.tiptap {
  width: 100%;
  word-break: break-word;
  @extend %text-s-regular;
  color: var(--light-text-backgroung-primary);

  p:empty::before {
    content: '\A';
    white-space: pre;
  }

  p {
    min-height: 1em;
  }

  pre {
    padding: 8px;
    border-radius: 0 8px 8px 0;
    border-left: 1px solid var(--light-text-backgroung-primary-50);
    background: var(--light-text-backgroung-primary-5);
    overflow: auto;
  }

  p.is-editor-empty:first-child::before {
    color: var(--light-text-backgroung-primary-50);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }

  :first-child {
    margin-top: 0;
  }

  h2 {
    @extend %text-xl-medium;
    margin: 24px 0 12px;
  }

  h3 {
    @extend %text-l-medium;
    margin: 20px 0 10px;
  }

  h4 {
    @extend %text-m-medium;
    margin: 16px 0 8px;
  }

  :first-child {
    margin-top: 0;
  }

  ul {
    list-style-type: disc;
    margin-left: 1.5em;
    padding-left: 0;
  }

  ol {
    list-style-type: decimal;
    margin-left: 1.5em;
    padding-left: 0;
  }

  &::selection {
    background: var(--primary-dark);
    color: var(--light-text-backgroung-primary);
  }

  &::-moz-selection {
    background: var(--primary-dark);
    color: var(--light-text-backgroung-primary);
  }

  .documentation-text-link {
    color: var(--primary);
    cursor: pointer;
    text-decoration: underline;
  }

  ul[data-type='taskList'] {
    list-style: none;
    margin-left: 0;
    padding: 0;

    li {
      align-items: start;
      display: flex;

      & > label {
        padding-left: 24px;
        user-select: none;
        position: relative;
        width: 16px;
        height: 16px;
        cursor: pointer;

        input {
          position: absolute;
          opacity: 0;
        }

        &::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          border-radius: 4px;
          border: 1px solid var(--light-text-backgroung-primary-25);
          margin-top: 2px;
          transition: all 0.2s ease;
        }

        &::after {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          margin-top: 2px;
          margin-left: 1px;
          background: url('../../assets/check.svg');
          opacity: 0;
          transition: opacity 0.2s ease;
        }
      }

      &[data-type='taskItem'] {
        &[data-checked] {
          div {
            text-decoration: line-through;
          }

          & > label {
            &::before {
              background-color: var(--primary);
              border-color: var(--primary);
            }

            &::after {
              opacity: 1;
            }
          }
        }
      }

      &[data-checked='true'] {
        div {
          text-decoration: line-through;
        }

        & > label {
          &::before {
            background-color: var(--primary);
            border-color: var(--primary);
          }

          &::after {
            opacity: 1;
          }
        }
      }
    }

    input[type='checkbox'] {
      cursor: pointer;
    }
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

  .mention {
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

  a {
    color: var(--primary);
  }

  &:focus-visible {
    outline: 1px solid var(--primary);
  }

  blockquote {
    position: relative;
    padding: 8px 48px 8px 12px;
    border-left: 1px solid var(--primary);
    background-color: var(--primary-25);
    border-radius: 0 8px 8px 0;
    display: inline-block;
    width: auto;
    max-width: 100%;
    box-sizing: border-box;
    word-break: break-word;

    &::before {
      content: '';
      position: absolute;
      right: 12px;
      top: 8px;
      width: 24px;
      height: 24px;
      background: url('../Icons/IconQuote.svg') no-repeat center / cover;
    }
  }

  table {
    border-collapse: collapse;
    margin: 0;
    overflow: hidden;
    table-layout: fixed;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    td,
    th {
      box-sizing: border-box;
      min-width: 82px;
      padding: 8px 12px;
      position: relative;
      border: 0.5px solid var(--light-text-backgroung-primary-10);

      > * {
        margin-bottom: 0;
      }
    }

    td {
      background-color: var(--light-text-backgroung-primary-5);
    }

    th {
      text-align: left;
    }

    .selectedCell:after {
      background: var(--gray-2);
      content: '';
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      pointer-events: none;
      position: absolute;
      z-index: 2;
    }

    .column-resize-handle {
      background-color: var(--purple);
      bottom: -2px;
      pointer-events: none;
      position: absolute;
      right: -2px;
      top: 0;
      width: 4px;
    }
  }

  .tableWrapper {
    margin: 1.5rem 0;
    overflow-x: auto;
    max-width: 100%;
  }

  &.resize-cursor {
    cursor: ew-resize;
    cursor: col-resize;
  }

  iframe {
    width: fit-content;
    height: fit-content;
  }
}
</style>
