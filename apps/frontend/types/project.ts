import type { JSONContent } from '@tiptap/vue-3';

export interface ProjectMember {
  id: number;
  first_name: string;
  last_name: string;
  photo_url?: string;
  email?: string;
  role?: string;
  cost?: number;
}

export interface Project {
  id: number;
  name: string;
  description: JSONContent;
  status: string;
  budget: number;
  hourlyRate: number;
  spentBudget: number;
  members: ProjectMember[];
}
