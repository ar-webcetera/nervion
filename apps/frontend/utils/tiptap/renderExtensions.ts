import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention from '@tiptap/extension-mention';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import { Image } from '~/utils/tiptap/image';
import { Table } from '~/utils/tiptap/table';
import { Iframe } from '~/utils/tiptap/iframe';
import { Video } from '~/utils/tiptap/video';
import { FileInlineNode } from '~/utils/tiptap/files';
import { AudioMessage } from '~/utils/tiptap/audio';

let cached: Extensions | null = null;

/**
 * Набор расширений ТОЛЬКО для статического рендера TipTap-JSON в HTML через generateHTML.
 * Здесь не нужны suggestion/placeholder/NodeView — используется лишь схема и renderHTML
 * каждого узла. Список зеркалит расширения из EditorTiptap.vue, чтобы generateHTML не падал
 * на неизвестном типе узла. Кэшируется (awsEndpoint в приложении один).
 */
export const getTiptapRenderExtensions = (awsEndpoint?: string): Extensions => {
  if (cached) return cached;
  const lowlight = createLowlight(common);
  cached = [
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    StarterKit.configure({ codeBlock: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    Image.configure({ awsEndpoint, inline: false }),
    Iframe,
    Video,
    FileInlineNode,
    AudioMessage,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'typescript', languageClassPrefix: 'language-' }),
    TaskItem,
    TaskList,
    Mention.configure({ HTMLAttributes: { class: 'mention' } }),
    Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true }),
  ];
  return cached;
};

interface TiptapNodeLike {
  type?: string;
  content?: TiptapNodeLike[];
}

/**
 * Узлы с интерактивным Vue NodeView, чей статический renderHTML непригоден
 * (например, голосовое сообщение рендерится в пустой div). Такие сообщения
 * рендерим через read-only EditorTiptap.
 */
export const INTERACTIVE_NODE_TYPES = new Set(['audioMessage', 'video', 'fileInline']);

export const docHasInteractiveNodes = (node: TiptapNodeLike | null | undefined): boolean => {
  if (!node || typeof node !== 'object') return false;
  if (node.type && INTERACTIVE_NODE_TYPES.has(node.type)) return true;
  if (Array.isArray(node.content)) {
    return node.content.some((child) => docHasInteractiveNodes(child));
  }
  return false;
};
