import { Node } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import AudioMessageNode from '~/components/TipTap/AudioMessageNode.vue';

export const AudioMessage = Node.create({
  name: 'audioMessage',

  group: 'block',

  selectable: true,
  draggable: false,
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      duration: {
        default: 0,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-audio-message]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-audio-message': '', ...HTMLAttributes }];
  },

  addNodeView() {
    return VueNodeViewRenderer(AudioMessageNode);
  },
});
