import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationsService } from './allocations.service';
import { AllocationsController } from './allocations.controller';
import { Allocations } from './entities/allocation.entity';
import { AuthModule } from '../auth/auth.module';
import { Users } from '../users/entities/users.entity';
import { ProjectMembers } from '../projects/entities/project.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Allocations, Users, ProjectMembers])],
  controllers: [AllocationsController],
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
