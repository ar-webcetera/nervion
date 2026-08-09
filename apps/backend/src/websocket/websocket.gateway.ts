import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { SOCKET_EVENT_TYPE } from './constants/socket';
import { Tasks } from '../tasks/entities/task.entity';
import { Comments } from '../comments/entities/comment.entity';
import { Notifications } from '../notifications/entities/notification.entity';
import { ChatMessage } from '../chats/entities/chat-message.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';

@WebSocketGateway({ namespace: '/ws', cors: true })
export class WebsocketGateway {
  @WebSocketServer()
  server: Server;
  private clients = new Map<string, string>();

  constructor() {}

  sendTaskAdded(task: Tasks) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.task_added, data: task });
  }

  sendTaskUpdate(task: Tasks) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.task_update, data: task });
  }

  sendTaskDeleted(taskId: number) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.task_deleted, data: { id: taskId } });
  }

  sendNotificationAdded(notification: Notifications) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.notification_added, data: notification });
  }

  sendNotificationUpdated(notification: Notifications) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.notification_updated, data: notification });
  }

  sendCommentAdded(comment: Comments) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.comment_added, data: comment });
  }

  sendCommentDeleted(commentId: number) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.comment_deleted, data: { id: commentId } });
  }

  sendCommentUpdated(comment: Comments) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.comment_updated, data: comment });
  }

  sendChatMessageAdded(message: ChatMessage) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.chat_message_added, data: message });
  }

  sendChatMessageDeleted(messageId: number) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.chat_message_deleted, data: { id: messageId } });
  }

  sendChatMessageUpdated(message: ChatMessage) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.chat_message_updated, data: message });
  }

  sendChatDeleted(chatId: string, memberIds: number[]) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.chat_deleted, data: { id: chatId, memberIds } });
  }

  sendVoiceRoomUpdate(projectId: number, participants: { userId: number; displayName: string; photoUrl: string | null }[]) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.voice_room_updated, data: { projectId, participants } });
  }

  sendTimelogUpdated(timelog: Timelogs) {
    this.server.emit('event', { type: SOCKET_EVENT_TYPE.timelog_updated, data: timelog });
  }

  sendTimelogDeleted(timelog: Pick<Timelogs, 'id' | 'task_id' | 'author_id'>) {
    this.server.emit('event', {
      type: SOCKET_EVENT_TYPE.timelog_deleted,
      data: { id: timelog.id, task_id: timelog.task_id, author_id: timelog.author_id },
    });
  }

  handleConnection(client: Socket) {
    const userId = this.getUserIdFromClient(client);
    if (userId) {
      this.clients.set(userId, client.id);
      client.emit('event', { type: SOCKET_EVENT_TYPE.users_online, data: { userIds: [...this.clients.keys()] } });
      this.server.emit('event', { type: SOCKET_EVENT_TYPE.user_online, data: { userId } });
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.clients.entries()) {
      if (socketId === client.id) {
        this.clients.delete(userId);
        this.server.emit('event', { type: SOCKET_EVENT_TYPE.user_offline, data: { userId } });
        break;
      }
    }
  }

  private getUserIdFromClient(client: Socket): string | null {
    const user_id = client.handshake.auth.user_id as string;
    if (!user_id) return null;
    return user_id;
  }
}
