import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ImageComponent from '~/components/TipTap/Image.vue';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';
import { IMAGE_UPLOAD_STATE_UPLOADING } from './imageUploadPlaceholder';
/* eslint-disable */

export interface ImageOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, never>;
  awsEndpoint: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        src: string;
        width?: string;
        alt?: string;
        title?: string;
        uploadId?: string;
        uploadName?: string;
        uploadState?: string;
      }) => ReturnType;
    };
  }
}

export const inputRegex = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/;

export const Image = Node.create<ImageOptions>({
  name: 'image',
  addOptions() {
    return {
      inline: true,
      allowBase64: false,
      HTMLAttributes: {},
      awsEndpoint: '',
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? 'inline' : 'block';
  },

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: 100,
      },
      uploadId: {
        default: null,
      },
      uploadName: {
        default: null,
      },
      uploadState: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]:not([src^="data:"])',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, uploadId, uploadName, uploadState, ...rest } = HTMLAttributes;
    if (uploadState === IMAGE_UPLOAD_STATE_UPLOADING) {
      return [
        'div',
        mergeAttributes(this.options.HTMLAttributes, {
          class: 'image-upload-placeholder',
          'data-upload-id': uploadId,
          'data-upload-name': uploadName,
        }),
      ];
    }
    const fullSrc = src && !src.startsWith('http') ? buildAwsObjectUrl(src, this.options.awsEndpoint) : src;

    return ['img', mergeAttributes(this.options.HTMLAttributes, { ...rest, src: fullSrc })];
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
  addNodeView() {
    // @ts-ignore
    return VueNodeViewRenderer(ImageComponent);
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;

          return { src, alt, title };
        },
      }),
    ];
  },
});
