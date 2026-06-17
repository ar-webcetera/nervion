import type { JSONContent } from '@tiptap/core';

export const hasTiptapContent = (value: JSONContent | null): boolean => {
  if (!value || !value.content) return false;
  return value.content.some(
    (item) =>
      Boolean(item.content?.length) ||
      (item.type === 'video' && Boolean(item.attrs?.src)) ||
      (item.type === 'iframe' && Boolean(item.attrs?.src)) ||
      (item.type === 'image' && Boolean(item.attrs?.src)),
  );
};
