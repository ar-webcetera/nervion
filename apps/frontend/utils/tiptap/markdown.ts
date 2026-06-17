import type { JSONContent } from '@tiptap/core';

export const downloadMarkdown = (markdown: string, fileName = 'document.md') => {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const MARKDOWN_PATTERNS: RegExp[] = [
  /^\s{0,3}#{1,6}\s+\S/m, // headings
  /^\s{0,3}>\s+\S/m, // blockquotes
  /^\s{0,3}[-*+]\s+\S/m, // bullet lists
  /^\s{0,3}\d+\.\s+\S/m, // ordered lists
  /^\s{0,3}- \[[ xX]\]\s+/m, // task lists
  /^\s{0,3}```/m, // fenced code block
  /^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/m, // hr
  /^\s{0,3}\|.+\|\s*$/m, // tables
  /\*\*[^\s*][^*]*\*\*/, // bold
  /(^|[^*])\*[^\s*][^*]*\*/, // italic
  /(^|[^_])_[^\s_][^_]*_/, // italic underscore
  /`[^`\n]+`/, // inline code
  /\[[^\]]+\]\([^)\s]+\)/, // links
  /!\[[^\]]*\]\([^)\s]+\)/, // images
];

export const looksLikeMarkdown = (text: string): boolean => {
  if (!text) return false;
  return MARKDOWN_PATTERNS.some((re) => re.test(text));
};

type ClipboardMarkdownNode = JSONContent | string;

const normalizeMarkdownNodes = (nodes: ReadonlyArray<ClipboardMarkdownNode>): JSONContent[] => {
  const normalized: JSONContent[] = [];

  for (const node of nodes) {
    if (typeof node === 'string') {
      if (!node) continue;
      normalized.push({ type: 'text', text: node });
      continue;
    }

    const hasContent = Array.isArray(node.content);
    const normalizedContent = hasContent
      ? normalizeMarkdownNodes(node.content as ReadonlyArray<ClipboardMarkdownNode>)
      : undefined;

    if (node.type === 'text') {
      if (!node.text) continue;
      normalized.push({ ...node, text: node.text, content: undefined });
      continue;
    }

    normalized.push({
      ...node,
      content: normalizedContent,
    });
  }

  return normalized;
};

export const wrapBareTextNodes = (nodes: JSONContent[]): JSONContent[] => {
  const normalized = normalizeMarkdownNodes(nodes as ReadonlyArray<ClipboardMarkdownNode>);
  return normalized.map((node) => (node.type === 'text' ? { type: 'paragraph', content: [node] } : node));
};

export const looksLikeCodeEditorHtml = (html: string): boolean => {
  if (!html) return false;
  return /font-family:[^;]*(?:Menlo|Consolas|Courier New|monospace)/i.test(html);
};

export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};
