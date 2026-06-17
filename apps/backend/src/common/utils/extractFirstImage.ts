import { TiptapNodeType } from '../enums/tiptap-node-type.enum';
import { TiptapDoc, TiptapNode } from '../types/tiptap';

export function extractFirstImage(doc: TiptapDoc): string | null {
  if (!doc) return null;

  let imageSrc: string | null = null;

  function walk(node: TiptapNode | TiptapDoc): boolean {
    if (
      (node.type as TiptapNodeType) === TiptapNodeType.Image &&
      'attrs' in node &&
      node.attrs &&
      'src' in node.attrs &&
      node.attrs.src
    ) {
      imageSrc = node.attrs.src as string;
      return true;
    }

    if ('content' in node && Array.isArray(node.content)) {
      for (const child of node.content) {
        if (walk(child)) return true;
      }
    }

    return false;
  }

  walk(doc);
  return imageSrc;
}
