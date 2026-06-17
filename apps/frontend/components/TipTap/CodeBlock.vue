<script setup lang="ts">
import BaseSelect from '~/components/BaseSelect.vue';
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3';

const props = defineProps(nodeViewProps);
const rawLanguages = props.extension.options.lowlight.listLanguages() as string[];

const languageOptions = computed(() =>
  rawLanguages.map((lang) => ({
    value: lang,
    label: lang,
  })),
);

const selectedLanguage = computed<string>({
  get: () => props.node.attrs.language,
  set: (language: string) => {
    props.updateAttributes({ language });
  },
});
</script>

<template>
  <NodeViewWrapper class="code-block">
    <BaseSelect
      v-if="props.editor.isEditable"
      v-model="selectedLanguage"
      class="code-block__select"
      :options="languageOptions"
      placeholder="Язык"
      small
      arrow
    />
    <NodeViewContent as="pre" />
  </NodeViewWrapper>
</template>

<style scoped lang="scss">
.tiptap {
  .code-block {
    position: relative;

    &__select {
      position: absolute;
      right: 24px;
      top: 8px;
      padding: 6px 12px;
      border-radius: 16px;
      border: 1px solid var(--light-text-backgroung-primary-10);
    }
  }
}
</style>
