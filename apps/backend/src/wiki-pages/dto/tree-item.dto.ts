export interface WikiPageMeta {
  id: number;
  name: string;
  parent_page_id: number | null;
  priority: number;
}

export interface WikiTreeNode extends WikiPageMeta {
  children: WikiTreeNode[];
}
