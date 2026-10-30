import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceService } from './voice.service';
import { VoiceGateway } from './voice.gateway';
import { WebsocketModule } from '../websocket/websocket.module';
import { Users } from '../users/entities/users.entity';
import { VoiceRoomEntity } from './entities/voice-room.entity';
import { VoiceRoomMember } from './entities/voice-room-member.entity';
import { VoiceRoomsController } from './voice-rooms.controller';
import { VoiceRoomsService } from './voice-rooms.service';
import { VoiceClusterService } from './voice-cluster.service';

@Module({
  imports: [TypeOrmModule.forFeature([Users, VoiceRoomEntity, VoiceRoomMember]), WebsocketModule],
  controllers: [VoiceRoomsController],
  providers: [VoiceService, VoiceClusterService, VoiceRoomsService, VoiceGateway],
})
export class VoiceModule {}
