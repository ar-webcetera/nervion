import { Module } from '@nestjs/common';
import { TimelogsController } from './timelogs.controller';
import { TimelogsService } from './timelogs.service';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { Timelogs } from './entities/timelog.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { ProjectMembers } from '../projects/entities/project.entity';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Users, Timelogs, Tasks, ProjectMembers]), WebsocketModule],
  controllers: [TimelogsController],
  providers: [TimelogsService],
})
export class TimelogsModule {}
