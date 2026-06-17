import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/notifications', cors: true })
export class NotificationsGateway {
  @WebSocketServer()
  server: Server;

  broadcastNewComment(comment: any) {
    this.server.emit('newNotification', comment);
  }
}
