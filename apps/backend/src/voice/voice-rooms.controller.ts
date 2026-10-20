import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';
import { UpdateVoiceRoomDto } from './dto/update-voice-room.dto';
import { VoiceRoomsService } from './voice-rooms.service';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@ApiTags('Голосовые комнаты')
@Controller('voice/rooms')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin, ROLES.employee)
export class VoiceRoomsController {
  constructor(private readonly voiceRoomsService: VoiceRoomsService) {}

  @Get()
  @ApiOperation({ summary: 'Получить доступные голосовые комнаты' })
  findAll(@Req() req: RequestWithUser) {
    return this.voiceRoomsService.findAll(req.user);
  }

  @Post()
  @ApiOperation({ summary: 'Создать голосовую комнату' })
  create(@Body() dto: CreateVoiceRoomDto, @Req() req: RequestWithUser) {
    return this.voiceRoomsService.create(dto, req.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить голосовую комнату' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVoiceRoomDto, @Req() req: RequestWithUser) {
    return this.voiceRoomsService.update(id, dto, req.user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить голосовую комнату' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.voiceRoomsService.remove(id, req.user);
  }
}
