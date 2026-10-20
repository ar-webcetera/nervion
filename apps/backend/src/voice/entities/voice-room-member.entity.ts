import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { VoiceRoomEntity } from './voice-room.entity';

@Entity({ name: 'voice_room_members' })
export class VoiceRoomMember {
  @PrimaryColumn({ type: 'integer' })
  room_id: number;

  @PrimaryColumn({ type: 'integer' })
  user_id: number;

  @ManyToOne(() => VoiceRoomEntity, (room) => room.member_links, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: VoiceRoomEntity;

  @ManyToOne(() => Users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;
}
