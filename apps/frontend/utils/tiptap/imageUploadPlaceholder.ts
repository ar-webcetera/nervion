import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const IMAGE_UPLOAD_STATE_UPLOADING = 'uploading';

type ImageUploadAttrs = {
  src?: string | null;
  width?: string | number | null;
  alt?: string | null;
  title?: string | null;
  uploadId?: string | null;
  uploadName?: string | null;
  uploadState?: string | null;
};

export const createImageUploadId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getImageUploadAttrs = (node: ProseMirrorNode): ImageUploadAttrs => {
  return node.attrs as ImageUploadAttrs;
};

const findImageUploadPlaceholderPosition = (editor: Editor, uploadId: string) => {
  if (editor.isDestroyed) return null;

  let foundPosition: number | null = null;

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'image') return true;

    const attrs = getImageUploadAttrs(node);
    if (attrs.uploadId !== uploadId || attrs.uploadState !== IMAGE_UPLOAD_STATE_UPLOADING) return true;

    foundPosition = position;
    return false;
  });

  return foundPosition;
};

export const insertImageUploadPlaceholder = (editor: Editor, uploadId: string, uploadName: string, previewSrc: string) => {
  if (editor.isDestroyed) return;

  editor
    .chain()
    .focus()
    .setImage({
      src: previewSrc,
      width: '200',
      uploadId,
      uploadName,
      uploadState: IMAGE_UPLOAD_STATE_UPLOADING,
    })
    .run();
};

export const replaceImageUploadPlaceholder = (editor: Editor, uploadId: string, src: string) => {
  if (editor.isDestroyed) return false;

  const position = findImageUploadPlaceholderPosition(editor, uploadId);
  if (position === null) return false;

  const node = editor.state.doc.nodeAt(position);
  if (!node) return false;
  const attrs = getImageUploadAttrs(node);
  const cleanImageNode = node.type.create({
    src,
    width: attrs.width ?? '200',
    alt: attrs.alt ?? null,
    title: attrs.title ?? null,
  });

  editor.view.dispatch(editor.state.tr.replaceWith(position, position + node.nodeSize, cleanImageNode));

  return true;
};

export const removeImageUploadPlaceholder = (editor: Editor, uploadId: string) => {
  if (editor.isDestroyed) return false;

  const position = findImageUploadPlaceholderPosition(editor, uploadId);
  if (position === null) return false;

  const node = editor.state.doc.nodeAt(position);
  if (!node) return false;

  editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize));
  return true;
};
