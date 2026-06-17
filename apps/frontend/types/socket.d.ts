import type { SOCKET_EVENT_TYPE } from '~/constants/socket.constants';
import type { Task, Timelog } from '~/types/task';
import type { Comment } from '~/types/comment';
import type { Notification } from '~/types/notification';
import type { ChatMessage } from '~/types/chat';

export interface UserOnlineEvent {
  userId: string;
}

export interface UsersOnlineEvent {
  userIds: string[];
}

export interface ChatDeletedEvent {
  id: string;
  memberIds: number[];
}

export interface SOCKET_EVENT {
  type: SOCKET_EVENT_TYPE;
  data: Task | Comment | Notification | ChatMessage | UserOnlineEvent | UsersOnlineEvent | ChatDeletedEvent | Timelog;
}
