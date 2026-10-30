import { Node, mergeAttributes } from '@tiptap/core';
import { buildAwsObjectUrl } from '~/utils/resolveUrl';

type VideoHtmlAttributes = Record<string, string | number | boolean | null | undefined>;

const sanitizeVideoAttributes = (attributes: VideoHtmlAttributes) => {
  const attrs = { ...attributes };
  const { src } = attrs;

  delete attrs.src;
  delete attrs.muted;
  delete attrs.autoplay;
  delete attrs.autoPlay;

  return {
    src,
    attrs,
  };
};

export const Video = Node.create<{ awsEndpoint?: string; tenantStorage: boolean }>({
  name: 'video',

  addOptions() { return { awsEndpoint: '', tenantStorage: false }; },

  group: 'block',

  selectable: true,
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      controls: {
        default: true,
      },
      width: {
        default: '100%',
      },
      height: {
        default: 'auto',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, attrs } = sanitizeVideoAttributes(HTMLAttributes);
    const normalizedSrc = typeof src === 'string'
      ? this.options.tenantStorage ? buildAwsObjectUrl(src, this.options.awsEndpoint, true) ?? '' : src
      : '';

    if (!normalizedSrc) {
      return ['video', mergeAttributes(attrs, { controls: true })];
    }
    return ['video', mergeAttributes(attrs, { controls: true }), ['source', { src: normalizedSrc, type: 'video/mp4' }]];
  },
});
