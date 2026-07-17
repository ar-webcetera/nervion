<script setup lang="ts">
import IconBold from '~/components/Icons/IconBold.vue';
import IconItalic from '~/components/Icons/IconItalic.vue';
import IconAlignLeft from '~/components/Icons/IconAlignLeft.vue';
import IconAlignCenter from '~/components/Icons/IconAlignCenter.vue';
import IconAlignRight from '~/components/Icons/IconAlignRight.vue';
import IconAlignJustify from '~/components/Icons/IconAlignJustify.vue';
import IconNumberList from '~/components/Icons/IconNumberList.vue';
import IconList from '~/components/Icons/IconList.vue';
import type { Editor as TiptapCoreEditor } from '@tiptap/core';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TiptapEditor = Omit<TiptapCoreEditor, 'chain'> & { chain: () => any };
import IconH2 from '~/components/Icons/IconH2.vue';
import IconH3 from '~/components/Icons/IconH3.vue';
import IconH4 from '~/components/Icons/IconH4.vue';
import IconLink from '~/components/Icons/IconLink.vue';
import IconConfirm from '~/components/Icons/IconConfirm.vue';
import IconTableAdd from '~/components/Icons/IconTableAdd.vue';
import IconAddImage from '~/components/Icons/IconAddImage.vue';
import IconAddVideo from '~/components/Icons/IconAddVideo.vue';
import IconTaskList from '~/components/Icons/IconTaskList.vue';
import IconBlockquote from '~/components/Icons/IconBlockquote.vue';
import IconAddFile from '~/components/Icons/IconAddFile.vue';
import IconUnderline from '../Icons/IconUnderline.vue';
import IconCode from '../Icons/IconCode.vue';
import IconImportMd from '../Icons/IconImportMd.vue';
import IconExportMd from '../Icons/IconExportMd.vue';

const props = defineProps<{
  editor: TiptapEditor | null;
  shortMenu?: boolean;
}>();

const emit = defineEmits(['add-image', 'add-video', 'add-code', 'add-file', 'import-md', 'export-md']);

const isModalOpen = ref(false);
const linkUrl = ref('');

const openLinkModal = () => {
  if (!props.editor) return;
  if (props.editor.isActive('link')) {
    const attrs = props.editor.getAttributes('link');
    linkUrl.value = attrs.href || '';
  }

  isModalOpen.value = true;
};

const closeLinkModal = () => {
  isModalOpen.value = false;
  linkUrl.value = '';
};

const applyLink = () => {
  if (!props.editor) return;
  props.editor.chain().focus().extendMarkRange('link');
  if (linkUrl.value) {
    props.editor.chain().setLink({ href: linkUrl.value, class: 'documentation-text-link' }).run();
  } else {
    props.editor.chain().unsetLink().run();
  }

  closeLinkModal();
};
</script>

<template>
  <div v-if="editor" :editor="editor" class="editor-menu">
    <button
      class="editor-menu__item"
      :class="{ 'editor-menu__item_active': editor.isActive('bold') }"
      @click="editor.chain().focus().toggleBold().run()"
    >
      <IconBold />
    </button>
    <button
      class="editor-menu__item"
      :class="{ 'editor-menu__item_active': editor.isActive('italic') }"
      @click="editor.chain().focus().toggleItalic().run()"
    >
      <IconItalic />
    </button>
    <button
      class="editor-menu__item"
      :class="{ 'editor-menu__item_active': editor.isActive('underline') }"
      @click="editor.chain().focus().toggleUnderline().run()"
    >
      <IconUnderline />
    </button>
    <template v-if="!shortMenu">
      <div class="divider" />
      <button
        :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive({ level: 2 }) }]"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        <IconH2 />
      </button>
      <button
        :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive({ level: 3 }) }]"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        <IconH3 />
      </button>
      <button
        :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive({ level: 4 }) }]"
        @click="editor.chain().focus().toggleHeading({ level: 4 }).run()"
      >
        <IconH4 />
      </button>
      <div class="divider" />
      <button
        class="editor-menu__item"
        :class="{ 'editor-menu__item_active': editor.isActive('bulletList') }"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <IconList />
      </button>
      <button
        class="editor-menu__item"
        :class="{ 'editor-menu__item_active': editor.isActive('orderedList') }"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        <IconNumberList />
      </button>
      <button
        class="editor-menu__item"
        :class="{ 'editor-menu__item_active': editor.isActive('taskList') }"
        @click="editor.chain().focus().toggleTaskList().run()"
      >
        <IconTaskList />
      </button>
      <div class="divider" />
      <button
        class="editor-menu__item"
        :class="{
          'editor-menu__item_active': editor.isActive({ textAlign: 'left' }),
        }"
        @click="editor.chain().focus().setTextAlign('left').run()"
      >
        <IconAlignLeft />
      </button>
      <button
        class="editor-menu__item"
        :class="{
          'editor-menu__item_active': editor.isActive({ textAlign: 'center' }),
        }"
        @click="editor.chain().focus().setTextAlign('center').run()"
      >
        <IconAlignCenter />
      </button>
      <button
        class="editor-menu__item"
        :class="{
          'editor-menu__item_active': editor.isActive({ textAlign: 'right' }),
        }"
        @click="editor.chain().focus().setTextAlign('right').run()"
      >
        <IconAlignRight />
      </button>
      <button
        class="editor-menu__item"
        :class="{
          'editor-menu__item_active': editor.isActive({ textAlign: 'justify' }),
        }"
        @click="editor.chain().focus().setTextAlign('justify').run()"
      >
        <IconAlignJustify />
      </button>
    </template>
    <div class="divider" />
    <button
      :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive('blockquote') }]"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      <IconBlockquote />
    </button>
    <button
      :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive('codeBlock') }]"
      @click="editor.chain().focus().toggleCodeBlock().run()"
    >
      <IconCode />
    </button>
    <button class="editor-menu__item" @click="emit('add-image')">
      <IconAddImage />
    </button>
    <button
      class="editor-menu__item"
      @click="emit('add-video')"
    >
      <IconAddVideo />
    </button>
    <button
      class="editor-menu__item"
      @click="editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()"
    >
      <IconTableAdd />
    </button>
    <button class="editor-menu__item" @click="emit('add-file')">
      <IconAddFile />
    </button>
    <button
      :class="['editor-menu__item', { 'editor-menu__item_active': editor.isActive('link') }]"
      @click="openLinkModal"
    >
      <IconLink />
    </button>
    <div class="divider" />
    <button class="editor-menu__item" title="Импортировать Markdown" @click="emit('import-md')">
      <IconImportMd />
    </button>
    <button class="editor-menu__item" title="Экспортировать Markdown" @click="emit('export-md')">
      <IconExportMd />
    </button>

    <div v-show="isModalOpen" class="modal-link">
      <input v-model="linkUrl" type="text" placeholder="Введите ссылку" />
      <button class="modal-link__button" @click="applyLink">
        <IconConfirm />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.divider {
  width: 1px;
  height: 20px;
  background-color: var(--light-text-backgroung-primary-10);
}

.editor-menu {
  @include flex(rw, a-center);
  gap: 4px;
  white-space: nowrap;
  position: relative;

  &__item {
    width: 24px;
    height: 24px;
    padding: 0;
    @include flex(center);
    border-radius: 4px;
    background: none;

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
}

.modal-link {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 8px;
  @include flex(rn);
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--light-text-backgroung-primary-5);
  box-shadow: 0 4px 4px 0 var(--black-25);
  backdrop-filter: blur(16px);
  z-index: 10;

  input {
    height: 32px;
    padding: 0 8px;
    width: 100%;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__button {
    @include flex(center);
    width: 32px;
    height: 32px;
    aspect-ratio: 1;
    border-radius: 20px;
    border: 1px solid var(--light-text-backgroung-primary-5);
    background: var(--primary-dark);
  }
}
</style>
