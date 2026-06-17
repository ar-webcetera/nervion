import { TiptapNodeType } from '../enums/tiptap-node-type.enum';

export interface TiptapDoc<Nodes extends TiptapNode[] = TiptapNode[]> {
  type: TiptapNodeType.Doc;
  content: Nodes;
}

interface GenericNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

export type TiptapNode = ParagraphNode | MentionNode | TextNode | ImageNode | GenericNode;

export interface ParagraphNode {
  type: TiptapNodeType.Paragraph;
  attrs: {
    textAlign: 'left' | 'right' | 'center' | 'justify' | null;
  };
  content: TiptapNode[];
}

export interface MentionNode {
  type: TiptapNodeType.Mention;
  attrs: {
    id: string;
    label: string | null;
    mentionSuggestionChar: string;
  };
}

export interface TextNode {
  type: TiptapNodeType.Text;
  text: string;
}

export interface ImageNode {
  type: TiptapNodeType.Image;
  attrs: {
    src: string;
    alt?: string | null;
    title?: string | null;
  };
}

export type AnyTiptapNode = TiptapDoc | ParagraphNode | MentionNode | TextNode | ImageNode | GenericNode;
