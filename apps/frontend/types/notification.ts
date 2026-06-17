import type { JSONContent } from '@tiptap/core';

export interface Notification {
  id: number;
  name: string;
  message: JSONContent;
  link: string;
  recipient_id: number;
  recipient: {
    id: number;
  };
  is_read: boolean;
  created_at: Date;
}
