export interface TiptapDoc<Nodes extends TiptapNode[] = TiptapNode[]> {
  type: 'doc';
  content: Nodes;
}

interface GenericNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

export type TiptapNode = ParagraphNode | MentionNode | TextNode | GenericNode;

export interface ParagraphNode {
  type: 'paragraph';
  attrs: {
    textAlign: 'left' | 'right' | 'center' | 'justify' | null;
  };
  content: TiptapNode[];
}

export interface MentionNode {
  type: 'mention';
  attrs: {
    id: string;
    label: string | null;
    mentionSuggestionChar: string;
  };
}

export interface TextNode {
  type: 'text';
  text: string;
}

export type AnyTiptapNode = TiptapDoc | ParagraphNode | MentionNode | TextNode;

export const extractPlainText = (doc: TiptapDoc, limit?: number): string => {
  let result = '';
  if (!doc) return result;
  const walk = (node: AnyTiptapNode) => {
    if (node.type === 'text' && typeof node.text === 'string') {
      result += node.text;
    }

    if (node.type === 'paragraph' && Array.isArray(node.content)) {
      //@ts-expect-error
      node.content.forEach(walk);
    }

    if (node.type === 'doc' && Array.isArray(node.content)) {
      //@ts-expect-error
      node.content.forEach(walk);
    }
  };

  walk(doc);

  if (limit && result.length > limit) {
    return result.slice(0, limit) + '...';
  }

  return result;
};
