import type { JSONContent } from '@tiptap/core';
import type { User } from '~/types/user';

export interface Comment {
  id: number;
  task_id: number;
  message: JSONContent;
  task?: {
    id: number;
  } | null;
  author?: User;
  comment_id?: number;
  author_id?: number;
  created_at: Date;
  updated_at: Date;
  subComments: Comment[];
  resolved?: boolean;
  isOpenThread?: boolean;
}
