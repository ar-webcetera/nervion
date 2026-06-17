import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import FileInline from '@/components/TipTap/FIleInline.vue';

export interface FileAttrs {
  href: string;
  name: string;
  ext?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileInline: {
      setFileInline: (attrs: FileAttrs) => ReturnType;
    };
  }
}

export const FileInlineNode = Node.create({
  name: 'fileInline',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      name: { default: null },
      ext: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="file-inline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const label = HTMLAttributes.name ? `${HTMLAttributes.name}${HTMLAttributes.ext ? '.' + HTMLAttributes.ext : ''}` : 'Файл';
    (HTMLAttributes.ext || 'file').toLowerCase();
    return [
      'span',
      mergeAttributes({ 'data-type': 'file-inline', class: 'file-inline' }, HTMLAttributes, {
        contenteditable: 'false',
      }),
      [
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'none' },
        [
          'path',
          {
            d: 'M7.50008 14.1667H12.5001M7.50008 11.6667H12.5001M10.8337 2.50073C10.7541 2.5 10.6646 2.5 10.5623 2.5H6.83358C5.90016 2.5 5.4331 2.5 5.07658 2.68166C4.76298 2.84145 4.50819 3.09623 4.3484 3.40983C4.16675 3.76635 4.16675 4.23341 4.16675 5.16683V14.8335C4.16675 15.7669 4.16675 16.2334 4.3484 16.5899C4.50819 16.9035 4.76298 17.1587 5.07658 17.3185C5.43275 17.5 5.89925 17.5 6.83086 17.5L13.1693 17.5C14.1009 17.5 14.5667 17.5 14.9229 17.3185C15.2365 17.1587 15.4921 16.9035 15.6519 16.5899C15.8334 16.2337 15.8334 15.7679 15.8334 14.8363V7.7714C15.8334 7.66918 15.8333 7.57961 15.8326 7.5M10.8337 2.50073C11.0716 2.5029 11.2215 2.51172 11.3652 2.54623C11.5353 2.58705 11.6983 2.65439 11.8474 2.74577C12.0156 2.84881 12.1599 2.99318 12.448 3.28125L15.0526 5.88582C15.3408 6.17407 15.4841 6.3178 15.5872 6.486C15.6786 6.63512 15.7462 6.79771 15.787 6.96777C15.8215 7.11149 15.8304 7.26212 15.8326 7.5M10.8337 2.50073L10.8334 4.83351C10.8334 5.76693 10.8334 6.23346 11.0151 6.58998C11.1749 6.90358 11.4296 7.15873 11.7432 7.31852C12.0994 7.5 12.5659 7.5 13.4975 7.5H15.8326',
            stroke: '#6F57F3',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          },
        ],
      ],
      ['a', { class: 'file-inline__link', href: HTMLAttributes.href, target: '_blank', rel: 'noopener noreferrer' }, label],
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(FileInline);
  },

  addCommands() {
    return {
      setFileInline:
        (attrs: FileAttrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});

export default FileInlineNode;
