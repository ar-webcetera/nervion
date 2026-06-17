import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkSchedulesService } from './work-schedules.service';
import { WorkSchedulesController } from './work-schedules.controller';
import { WorkSchedules } from './entities/work-schedule.entity';
import { AuthModule } from '../auth/auth.module';
import { Users } from '../users/entities/users.entity';
import { ProjectMembers } from '../projects/entities/project.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([WorkSchedules, Users, ProjectMembers])],
  controllers: [WorkSchedulesController],
  providers: [WorkSchedulesService],
  exports: [WorkSchedulesService],
})
export class WorkSchedulesModule {}
