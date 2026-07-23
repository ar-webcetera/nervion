import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { Notifications } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { WebsocketModule } from '../websocket/websocket.module';
import { PushModule } from '../push/push.module';
import { MailModule } from '../mail/mail.module';
import { MailboxCoreModule } from '../mailbox/mailbox-core.module';

@Module({
  imports: [WebsocketModule, TypeOrmModule.forFeature([Notifications, Users]), PushModule, MailModule, MailboxCoreModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
