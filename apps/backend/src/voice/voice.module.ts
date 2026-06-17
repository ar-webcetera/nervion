import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceService } from './voice.service';
import { VoiceGateway } from './voice.gateway';
import { WebsocketModule } from '../websocket/websocket.module';
import { ProjectMembers } from '../projects/entities/project.entity';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectMembers, Users]), WebsocketModule],
  providers: [VoiceService, VoiceGateway],
})
export class VoiceModule {}
