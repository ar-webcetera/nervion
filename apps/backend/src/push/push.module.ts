import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { AuthModule } from '../auth/auth.module';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, Users]), ConfigModule, AuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
