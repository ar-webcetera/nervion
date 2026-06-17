export interface QuickLink {
  id: number;
  title: string;
  url: string;
  user_id: number;
  project_id: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CreateQuickLinkDto {
  title?: string;
  url: string;
  position?: number;
  project_id: number;
}

export interface UpdateQuickLinkDto {
  title?: string;
  url?: string;
  position?: number;
}
