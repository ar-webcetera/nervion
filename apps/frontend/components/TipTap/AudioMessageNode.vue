<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import ChatAudioPlayer from '~/components/Chat/ChatAudioPlayer.vue';

const props = defineProps(nodeViewProps);
</script>

<template>
  <NodeViewWrapper>
    <ChatAudioPlayer :src="(props.node.attrs.src as string) || ''" :duration="(props.node.attrs.duration as number) || 0" />
  </NodeViewWrapper>
</template>
