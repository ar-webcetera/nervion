import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { Notifications } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { WebsocketModule } from '../websocket/websocket.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [WebsocketModule, TypeOrmModule.forFeature([Notifications, Users]), PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
