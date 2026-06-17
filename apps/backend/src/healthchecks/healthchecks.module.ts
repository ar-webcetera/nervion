import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthCheck } from './entities/healthcheck.entity';
import { HealthchecksService } from './healthchecks.service';
import { HealthchecksController } from './healthchecks.controller';
import { ChatsModule } from '../chats/chats.module';
import { AuthModule } from '../auth/auth.module';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HealthCheck, Users]), ChatsModule, AuthModule],
  controllers: [HealthchecksController],
  providers: [HealthchecksService],
})
export class HealthchecksModule {}
