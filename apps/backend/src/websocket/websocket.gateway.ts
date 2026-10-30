import { ProjectRealtimeEvent, TaskBusinessKind } from '@tracker/contracts';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SOCKET_EVENT_TYPE } from './constants/socket';
import { Tasks } from '../tasks/entities/task.entity';
import { Comments } from '../comments/entities/comment.entity';
import { Notifications } from '../notifications/entities/notification.entity';
import { ChatMessage } from '../chats/entities/chat-message.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Projects } from '../projects/entities/project.entity';
import { ROLES } from '../common/enums/roles.enum';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PlatformService } from '../platform/platform.service';
import { TenantSocketIdentity, TenantSocketService } from './tenant-socket.service';

type Audience = 'tenant' | 'admin' | number[];
type AudienceResolver = () => Audience | Promise<Audience>;
type RealtimePeer = Awaited<ReturnType<Server['fetchSockets']>>[number];

@WebSocketGateway({ namespace: '/ws', cors: true })
export class WebsocketGateway {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly db: DataSource,
    private readonly context: TenantContextService,
    private readonly database: TenantDatabaseService,
    private readonly platform: PlatformService,
    private readonly sockets: TenantSocketService,
  ) {}

  afterInit(server: Server): void {
    server.use((client, next) => {
      this.sockets.connect(client).then(
        () => next(),
        () => next(new Error('Unauthorized')),
      );
    });
  }

  // Audience and sessions are checked after commit in a fresh transaction.
  private dispatch(event: string, data?: object, resolveAudience: AudienceResolver = () => 'tenant'): Promise<void> {
    const captured = this.context.isEnabled() ? this.context.require().tenant : undefined;
    const deliver = async () => {
      const audience = await resolveAudience();
      const room = this.sockets.room(captured?.id ?? 'legacy');
      for (const client of await this.server.in(room).fetchSockets()) {
        try {
          const identity = await this.sockets.authenticate(client.handshake);
          if (identity.tenantId !== (captured?.id ?? 'legacy')) continue;
          if (audience === 'admin' && identity.role !== String(ROLES.admin)) continue;
          if (Array.isArray(audience) && !audience.includes(identity.userId)) continue;
          client.emit(event, data);
        } catch {
          client.disconnect(true);
        }
      }
    };
    const perform = async () => {
      if (!this.server) return;
      try {
        if (captured) await this.database.run(await this.platform.getTenant(captured.id), deliver, { readOnly: true });
        else await deliver();
      } catch {
        this.logger.warn('Realtime delivery failed');
      }
    };
    if (captured) {
      this.context.require().afterCommit.push(perform);
      return Promise.resolve();
    }
    return perform();
  }

  private event(type: SOCKET_EVENT_TYPE, data: object, audience?: AudienceResolver): void {
    void this.dispatch('event', { type, data }, audience);
  }

  private async projectAudience(projectId?: number | null): Promise<Audience> {
    if (!projectId) return 'tenant';
    const project = await this.db
      .getRepository(Projects)
      .findOne({ where: { id: projectId }, select: ['id', 'isPrivate', 'ownerId'] });
    if (!project) return [];
    return project.isPrivate ? (project.ownerId ? [project.ownerId] : []) : 'tenant';
  }

  private async taskAudience(taskId?: number | null): Promise<Audience> {
    if (!taskId) return [];
    const task = await this.db
      .getRepository(Tasks)
      .findOne({ where: { id: taskId }, select: ['id', 'project_id', 'business_kind'] });
    if (!task) return [];
    return task.business_kind === TaskBusinessKind.SALES ? 'admin' : this.projectAudience(task.project_id);
  }

  private async chatAudience(chatId: string): Promise<Audience> {
    const members = await this.db.query<Array<{ user_id: number }>>(
      'SELECT user_id FROM chat_members WHERE chat_id = $1 AND left_at IS NULL',
      [chatId],
    );
    return members.map((member) => member.user_id);
  }

  sendProjectsChanged(): void {
    void this.dispatch(ProjectRealtimeEvent.CHANGED);
  }
  async sendCrmChanged(): Promise<void> {
    return this.dispatch('crm:changed', undefined, () => 'admin');
  }
  sendTaskAdded(task: Tasks): Promise<void> {
    return Promise.resolve(this.sendTask(SOCKET_EVENT_TYPE.task_added, task));
  }
  sendTaskUpdate(task: Tasks): Promise<void> {
    return Promise.resolve(this.sendTask(SOCKET_EVENT_TYPE.task_update, task));
  }

  private sendTask(type: SOCKET_EVENT_TYPE, task: Tasks): void {
    if (task.business_kind === TaskBusinessKind.SALES) {
      this.event(type, task, () => 'admin');
      void this.sendCrmChanged();
    } else {
      const { deal_id: _dealId, ...publicTask } = task;
      this.event(type, publicTask, () => this.projectAudience(task.project_id ?? task.project?.id));
    }
  }

  sendTaskDeleted(id: number, commercial = false, privateOwnerId?: number | null): void {
    this.event(SOCKET_EVENT_TYPE.task_deleted, { id }, () =>
      commercial ? 'admin' : privateOwnerId ? [privateOwnerId] : 'tenant',
    );
    if (commercial) void this.sendCrmChanged();
  }
  sendNotificationAdded(notification: Notifications, recipientId: number): void {
    this.event(SOCKET_EVENT_TYPE.notification_added, notification, () => [recipientId]);
  }
  sendNotificationUpdated(notification: Notifications, recipientId: number): void {
    this.event(SOCKET_EVENT_TYPE.notification_updated, notification, () => [recipientId]);
  }
  sendCommentAdded(comment: Comments): Promise<void> {
    return Promise.resolve(
      this.event(SOCKET_EVENT_TYPE.comment_added, comment, () => this.taskAudience(comment.task_id ?? comment.task?.id)),
    );
  }
  sendCommentUpdated(comment: Comments): Promise<void> {
    return Promise.resolve(
      this.event(SOCKET_EVENT_TYPE.comment_updated, comment, () => this.taskAudience(comment.task_id ?? comment.task?.id)),
    );
  }
  sendCommentDeleted(id: number, commercial = false, privateOwnerId?: number | null): void {
    this.event(SOCKET_EVENT_TYPE.comment_deleted, { id }, () =>
      commercial ? 'admin' : privateOwnerId ? [privateOwnerId] : 'tenant',
    );
  }
  sendChatMessageAdded(message: ChatMessage): void {
    this.event(SOCKET_EVENT_TYPE.chat_message_added, message, () => this.chatAudience(message.chat_id));
  }
  sendChatMessageUpdated(message: ChatMessage): void {
    this.event(SOCKET_EVENT_TYPE.chat_message_updated, message, () => this.chatAudience(message.chat_id));
  }
  sendChatMessageDeleted(id: number): void {
    this.event(SOCKET_EVENT_TYPE.chat_message_deleted, { id });
  }
  sendChatDeleted(id: string, memberIds: number[]): void {
    this.event(SOCKET_EVENT_TYPE.chat_deleted, { id, memberIds }, () => memberIds);
  }
  sendVoiceRoomsChanged(): void {
    this.event(SOCKET_EVENT_TYPE.voice_rooms_changed, {});
  }
  sendVoiceRoomUpdate(
    roomId: number,
    participants: { userId: number; displayName: string; photoUrl: string | null }[],
  ): Promise<void> {
    return Promise.resolve(
      this.event(SOCKET_EVENT_TYPE.voice_room_updated, { roomId, participants }, async () => {
        const members = await this.db.query<Array<{ user_id: number }>>(
          'SELECT user_id FROM voice_room_members WHERE room_id = $1',
          [roomId],
        );
        return members.map((member) => member.user_id);
      }),
    );
  }
  sendTimelogUpdated(timelog: Timelogs): Promise<void> {
    return Promise.resolve(this.event(SOCKET_EVENT_TYPE.timelog_updated, timelog, () => this.taskAudience(timelog.task_id)));
  }
  sendTimelogDeleted(timelog: Pick<Timelogs, 'id' | 'task_id' | 'author_id'>): Promise<void> {
    return Promise.resolve(this.event(SOCKET_EVENT_TYPE.timelog_deleted, timelog, () => this.taskAudience(timelog.task_id)));
  }

  async handleConnection(client: Pick<Socket, 'id' | 'data' | 'emit' | 'disconnect'>): Promise<void> {
    const identity = this.sockets.identity(client);
    if (!identity) {
      client.disconnect(true);
      return;
    }
    const peers = await this.activePeers(identity.tenantId);
    if (!peers.some((peer) => peer.client.id === client.id)) {
      client.disconnect(true);
      return;
    }
    const userIds = [...new Set(peers.map((peer) => peer.identity.userId))].map(String);
    client.emit('event', { type: SOCKET_EVENT_TYPE.users_online, data: { userIds } });
    for (const peer of peers)
      peer.client.emit('event', { type: SOCKET_EVENT_TYPE.user_online, data: { userId: String(identity.userId) } });
  }

  async handleDisconnect(client: Pick<Socket, 'id' | 'data' | 'emit' | 'disconnect'>): Promise<void> {
    const identity = this.sockets.identity(client);
    if (!identity) return;
    const peers = await this.activePeers(identity.tenantId);
    if (peers.some((peer) => peer.identity.userId === identity.userId)) return;
    for (const peer of peers)
      peer.client.emit('event', { type: SOCKET_EVENT_TYPE.user_offline, data: { userId: String(identity.userId) } });
  }

  private async activePeers(tenantId: string): Promise<Array<{ client: RealtimePeer; identity: TenantSocketIdentity }>> {
    const peers = await this.server.in(this.sockets.room(tenantId)).fetchSockets();
    const active: Array<{ client: RealtimePeer; identity: TenantSocketIdentity }> = [];
    for (const client of peers) {
      try {
        const identity = await this.sockets.authenticate(client.handshake);
        if (identity.tenantId !== tenantId) {
          client.disconnect(true);
          continue;
        }
        active.push({ client, identity });
      } catch {
        client.disconnect(true);
      }
    }
    return active;
  }
}
