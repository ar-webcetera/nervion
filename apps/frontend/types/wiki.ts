import type { JSONContent } from '@tiptap/core';

export interface WikiPage {
  id: number;
  name: string;
  priority: number;
  description: JSONContent;
  project_id: number;
  parent_page_id: number | null;
  children?: WikiPage[];
}

export interface WikiTreeItem {
  id: number;
  name: string;
  parent_page_id: number | null;
  priority: number;
}

export interface WikiTreeNode extends WikiTreeItem {
  children: WikiTreeNode[];
}
