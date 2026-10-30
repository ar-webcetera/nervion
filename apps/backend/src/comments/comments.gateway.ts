import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/comments', cors: true })
export class CommentsGateway {
  @WebSocketServer()
  server: Server;

  afterInit(server: Server): void {
    if (process.env.TENANCY_ENABLED === 'true')
      server.use((_client, next) => next(new Error('Use the authenticated /ws namespace')));
  }

  /**
   * Рассылает всем подписанным клиентам новое событие
   */
  broadcastNewComment(comment: any) {
    if (process.env.TENANCY_ENABLED === 'true') throw new Error('Use tenant-scoped WebsocketGateway');
    this.server.emit('newComment', comment);
  }
}
