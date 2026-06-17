import { Module } from '@nestjs/common';
import { ReportingsService } from './reportings.service';
import { ReportingsController } from './reportings.controller';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Tasks } from '../tasks/entities/task.entity';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Users, Timelogs, Tasks])],
  controllers: [ReportingsController],
  providers: [ReportingsService],
})
export class ReportingsModule {}
