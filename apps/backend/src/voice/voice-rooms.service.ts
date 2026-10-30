import type { VoiceRoom, VoiceRoomUser } from '@tracker/contracts';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ROLES } from '../common/enums/roles.enum';
import { Users } from '../users/entities/users.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';
import { UpdateVoiceRoomDto } from './dto/update-voice-room.dto';
import { VoiceRoomMember } from './entities/voice-room-member.entity';
import { VoiceRoomEntity } from './entities/voice-room.entity';
import { VoiceService } from './voice.service';
import { VoiceClusterService } from './voice-cluster.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { voiceRoomKey } from './voice.protocol';

@Injectable()
export class VoiceRoomsService {
  constructor(
    @InjectRepository(VoiceRoomEntity)
    private readonly roomRepository: Repository<VoiceRoomEntity>,
    @InjectRepository(VoiceRoomMember)
    private readonly memberRepository: Repository<VoiceRoomMember>,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly websocketGateway: WebsocketGateway,
    private readonly voiceService: VoiceService,
    private readonly cluster: VoiceClusterService,
    private readonly context: TenantContextService,
  ) {}

  async findAll(currentUser: AuthenticatedUser): Promise<VoiceRoom[]> {
    const query = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.owner', 'owner')
      .leftJoinAndSelect('room.member_links', 'member_link')
      .leftJoinAndSelect('member_link.user', 'member')
      .innerJoin('room.member_links', 'access_member', 'access_member.user_id = :userId', {
        userId: currentUser.id,
      })
      .orderBy('room.created_at', 'ASC')
      .addOrderBy('member.last_name', 'ASC')
      .addOrderBy('member.first_name', 'ASC');

    return Promise.all((await query.getMany()).map((room) => this.toContract(room, currentUser)));
  }

  async create(dto: CreateVoiceRoomDto, currentUser: AuthenticatedUser): Promise<VoiceRoom> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название комнаты');

    const memberIds = await this.validateMemberIds(dto.member_ids, currentUser.id);
    const room = await this.roomRepository.manager.transaction(async (manager) => {
      const savedRoom = await manager
        .getRepository(VoiceRoomEntity)
        .save(manager.getRepository(VoiceRoomEntity).create({ name, owner_id: currentUser.id }));
      await manager
        .getRepository(VoiceRoomMember)
        .save(
          memberIds.map((userId) => manager.getRepository(VoiceRoomMember).create({ room_id: savedRoom.id, user_id: userId })),
        );
      return savedRoom;
    });

    this.websocketGateway.sendVoiceRoomsChanged();
    return this.findOne(room.id, currentUser);
  }

  async update(id: number, dto: UpdateVoiceRoomDto, currentUser: AuthenticatedUser): Promise<VoiceRoom> {
    const room = await this.findEntity(id);
    this.assertCanManage(room, currentUser);

    const name = dto.name === undefined ? room.name : dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название комнаты');
    const memberIds =
      dto.member_ids === undefined
        ? room.member_links.map((member) => member.user_id)
        : await this.validateMemberIds(dto.member_ids, room.owner_id);

    await this.roomRepository.manager.transaction(async (manager) => {
      await manager.getRepository(VoiceRoomEntity).update(id, { name });
      if (dto.member_ids !== undefined) {
        await manager.getRepository(VoiceRoomMember).delete({ room_id: id });
        await manager
          .getRepository(VoiceRoomMember)
          .save(memberIds.map((userId) => manager.getRepository(VoiceRoomMember).create({ room_id: id, user_id: userId })));
      }
    });

    this.websocketGateway.sendVoiceRoomsChanged();
    return this.findOne(id, currentUser);
  }

  async remove(id: number, currentUser: AuthenticatedUser): Promise<void> {
    const room = await this.findEntity(id);
    this.assertCanManage(room, currentUser);
    await this.roomRepository.delete(id);
    this.websocketGateway.sendVoiceRoomsChanged();
  }

  async findOne(id: number, currentUser: AuthenticatedUser): Promise<VoiceRoom> {
    const room = await this.findEntity(id);
    const hasAccess = currentUser.role === ROLES.admin || room.member_links.some((member) => member.user_id === currentUser.id);
    if (!hasAccess) throw new ForbiddenException('Нет доступа к голосовой комнате');
    return this.toContract(room, currentUser);
  }

  async canJoin(roomId: number, userId: number): Promise<boolean> {
    return this.memberRepository.existsBy({ room_id: roomId, user_id: userId });
  }

  private async findEntity(id: number): Promise<VoiceRoomEntity> {
    const room = await this.roomRepository.findOne({
      where: { id },
      relations: ['owner', 'member_links', 'member_links.user'],
    });
    if (!room) throw new NotFoundException('Голосовая комната не найдена');
    return room;
  }

  private assertCanManage(room: VoiceRoomEntity, currentUser: AuthenticatedUser): void {
    if (room.owner_id !== currentUser.id && currentUser.role !== ROLES.admin) {
      throw new ForbiddenException('Изменять комнату может только её создатель');
    }
  }

  private async validateMemberIds(ids: number[], ownerId: number): Promise<number[]> {
    const memberIds = [...new Set([...ids, ownerId])];
    const users = await this.userRepository.find({
      where: { id: In(memberIds), role: In([ROLES.admin, ROLES.employee]) },
      select: ['id'],
    });
    if (users.length !== memberIds.length) throw new BadRequestException('Один или несколько участников недоступны');
    return memberIds;
  }

  private async toContract(room: VoiceRoomEntity, currentUser: AuthenticatedUser): Promise<VoiceRoom> {
    const key = voiceRoomKey(this.context.isEnabled() ? this.context.require().tenant.id : 'legacy', room.id);
    const presence = await this.cluster.presence(key);
    return {
      id: room.id,
      name: room.name,
      owner_id: room.owner_id,
      owner: this.toUser(room.owner),
      members: room.member_links
        .map((member) => this.toUser(member.user))
        .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'ru')),
      active_participants: presence ?? this.voiceService.getRoomParticipants(key).map((participant) => ({
        userId: participant.userId,
        displayName: participant.displayName,
        photoUrl: participant.photoUrl,
      })),
      can_manage: room.owner_id === currentUser.id || currentUser.role === ROLES.admin,
      created_at: room.created_at.toISOString(),
      updated_at: room.updated_at.toISOString(),
    };
  }

  private toUser(user: Users): VoiceRoomUser {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      photo_url: user.photo_url ?? null,
    };
  }
}
