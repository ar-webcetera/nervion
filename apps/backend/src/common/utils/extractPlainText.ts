import { TiptapNodeType } from '../enums/tiptap-node-type.enum';
import { AnyTiptapNode, TiptapDoc } from '../types/tiptap';

const BLOCK_NODES = new Set<string>([
  TiptapNodeType.Doc,
  TiptapNodeType.Paragraph,
  TiptapNodeType.Heading,
  TiptapNodeType.Blockquote,
  TiptapNodeType.CodeBlock,
  TiptapNodeType.ListItem,
]);

export enum ExtractPlainTextMode {
  FIRST_MEANINGFUL_NODE = 'first_meaningful_node',
  ALL_NODES = 'all_nodes',
}

export function extractPlainText(
  doc: TiptapDoc | null | undefined,
  limit?: number,
  mode: ExtractPlainTextMode = ExtractPlainTextMode.FIRST_MEANINGFUL_NODE,
): string {
  if (!doc) return '';

  const parts: string[] = [];

  function hasMeaningfulContent(node: AnyTiptapNode): boolean {
    const type = node.type as TiptapNodeType;

    if (
      type === TiptapNodeType.AudioMessage ||
      type === TiptapNodeType.Image ||
      node.type === 'video' ||
      node.type === 'fileInline'
    ) {
      return true;
    }

    if (type === TiptapNodeType.Text && 'text' in node && typeof node.text === 'string') {
      return node.text.trim().length > 0;
    }

    if (
      type === TiptapNodeType.Emoji &&
      'attrs' in node &&
      node.attrs &&
      typeof node.attrs === 'object' &&
      'name' in node.attrs &&
      typeof node.attrs.name === 'string'
    ) {
      return true;
    }

    if ('content' in node && Array.isArray(node.content)) {
      return node.content.some((child) => hasMeaningfulContent(child as AnyTiptapNode));
    }

    return false;
  }

  function walk(node: AnyTiptapNode) {
    const type = node.type as TiptapNodeType;

    if (type === TiptapNodeType.Doc && 'content' in node && Array.isArray(node.content)) {
      if (mode === ExtractPlainTextMode.ALL_NODES) {
        node.content.forEach((item) => walk(item as AnyTiptapNode));
        return;
      }

      const firstNode = node.content.find((item) => hasMeaningfulContent(item as AnyTiptapNode));
      if (firstNode) walk(firstNode as AnyTiptapNode);
      return;
    }

    if (type === TiptapNodeType.AudioMessage) {
      parts.push('Голосовое сообщение');
      return;
    }

    if (type === TiptapNodeType.Image) {
      parts.push('Изображение');
      return;
    }

    if (node.type === 'video') {
      parts.push('Видео');
      return;
    }

    if (node.type === 'fileInline') {
      parts.push('Файл');
      return;
    }

    if (
      type === TiptapNodeType.Emoji &&
      'attrs' in node &&
      node.attrs &&
      typeof node.attrs === 'object' &&
      'name' in node.attrs &&
      typeof node.attrs.name === 'string'
    ) {
      parts.push(`:${node.attrs.name}:`);
      return;
    }

    if (type === TiptapNodeType.Text && 'text' in node && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }

    if (type === TiptapNodeType.HardBreak) {
      parts.push('\n');
      return;
    }

    if ('content' in node && Array.isArray(node.content)) {
      if (type === TiptapNodeType.ListItem) parts.push('• ');
      node.content.forEach(walk);
      if (BLOCK_NODES.has(type)) parts.push('\n');
    }
  }

  walk(doc);

  const result = parts.join('').trim();

  if (limit && result.length > limit) {
    return result.slice(0, limit) + '...';
  }

  return result;
}
