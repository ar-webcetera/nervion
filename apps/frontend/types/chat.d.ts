import type { JSONContent } from '@tiptap/core';
import type { User } from '~/types/user';

export interface ChatReplyPreview {
  id: string;
  author: { id: number; first_name: string; last_name: string } | null;
  snippet: string;
  is_deleted: boolean;
}

export interface Chat {
  id: string;
  sender_id: string | null;
  message: JSONContent | null;
  is_edited: boolean;
  is_deleted: boolean;
  deleted_at: Date | null;
  reply_to_id: string | null;
  reply_to?: ChatReplyPreview | null;
  edited_at: Date | null;
  chat_id: string;
  chat: Chat;
  author: User | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sender_id: string | null;
  message: JSONContent | null;
  is_edited: boolean;
  is_deleted: boolean;
  deleted_at: Date | null;
  reply_to_id: string | null;
  reply_to?: ChatReplyPreview | null;
  edited_at: Date | null;
  chat_id: string;
  chat: Chat;
  author: User | null;
  createdAt: Date;
  updatedAt: Date;
}
