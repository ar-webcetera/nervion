import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comments } from './entities/comment.entity';
import { Users } from '../users/entities/users.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { CommentsGateway } from './comments.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ProjectMembers } from '../projects/entities/project.entity';

@Module({
  imports: [WebsocketModule, NotificationsModule, TypeOrmModule.forFeature([Comments, Users, Tasks, ProjectMembers])],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsGateway],
})
export class CommentsModule {}
