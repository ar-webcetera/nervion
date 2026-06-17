import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/comments', cors: true })
export class CommentsGateway {
  @WebSocketServer()
  server: Server;

  /**
   * Рассылает всем подписанным клиентам новое событие
   */
  broadcastNewComment(comment: any) {
    this.server.emit('newComment', comment);
  }
}
