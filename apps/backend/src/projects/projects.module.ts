import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMembers, Projects } from './entities/project.entity';
import { Users } from '../users/entities/users.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Tasks } from '../tasks/entities/task.entity';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Projects, Users, ProjectMembers, Timelogs, Tasks])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
