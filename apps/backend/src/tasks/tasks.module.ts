import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { Tasks } from './entities/task.entity';
import { Projects } from '../projects/entities/project.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { WebsocketModule } from '../websocket/websocket.module';
import { Comments } from '../comments/entities/comment.entity';
import { ProjectMembers } from '../projects/entities/project.entity';
import { UserTaskFilter } from 'src/tasks/entities/user-task-filter.entity';
import { TaskCompletion } from 'src/tasks/entities/task-completion.entity';
import { DeepseekModule } from 'src/deepseek/deepseek.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [
    DeepseekModule,
    NotificationsModule,
    WebsocketModule,
    HttpModule,
    TypeOrmModule.forFeature([Timelogs, Users, Tasks, Projects, Comments, ProjectMembers, UserTaskFilter, TaskCompletion]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
