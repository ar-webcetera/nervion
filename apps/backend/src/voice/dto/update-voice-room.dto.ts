import { PartialType } from '@nestjs/mapped-types';
import { CreateVoiceRoomDto } from './create-voice-room.dto';

export class UpdateVoiceRoomDto extends PartialType(CreateVoiceRoomDto) {}
