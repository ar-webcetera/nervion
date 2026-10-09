import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeepseekModule } from '../deepseek/deepseek.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
@Module({
  imports: [TasksModule, WebsocketModule, NotificationsModule, DeepseekModule],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
