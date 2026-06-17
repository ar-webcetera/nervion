import { Node, mergeAttributes } from '@tiptap/core';

type IframeHtmlAttributes = Record<string, string | number | boolean | null | undefined>;

const removeMutedPlaybackParams = (src: string) => {
  try {
    const url = new URL(src);
    url.searchParams.delete('mute');
    url.searchParams.delete('muted');
    url.searchParams.delete('autoplay');

    return url.toString();
  } catch {
    return src;
  }
};

const normalizeIframeAttributes = (attributes: IframeHtmlAttributes) => ({
  ...attributes,
  src: typeof attributes.src === 'string' ? removeMutedPlaybackParams(attributes.src) : attributes.src,
  allow: 'fullscreen; picture-in-picture',
});

export const Iframe = Node.create({
  name: 'iframe',
  group: 'block',
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
      frameborder: { default: '0' },
      allowfullscreen: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'iframe[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(this.options.HTMLAttributes, normalizeIframeAttributes(HTMLAttributes))];
  },
});
