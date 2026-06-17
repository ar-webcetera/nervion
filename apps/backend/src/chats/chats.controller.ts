import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Chat } from './entities/chat.entity';
import { RequestWithCookies } from '../common/types/request';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatListItemDto } from './dto/chat-list-item.dto';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatMessagesResponseDto } from './dto/chat-messages-response.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { AddChatMemberDto } from './dto/add-chat-member.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';

@ApiTags('Чаты')
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @ApiOperation({ summary: 'Создать групповой чат' })
  @ApiResponse({ status: 201, description: 'Групповой чат создан' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (требуется роль администратора)' })
  @ApiCreatedResponse({ type: Chat })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @Post('group')
  createGroup(@Body() dto: CreateGroupChatDto, @Req() req: RequestWithCookies) {
    return this.chatsService.createGroupChat(req.user.id, dto.name, dto.memberIds);
  }

  @ApiOperation({ summary: 'Создать личный чат с пользователем' })
  @ApiResponse({ status: 201, description: 'Личный чат создан' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiCreatedResponse({ type: Chat })
  @UseGuards(AuthGuard)
  @Post()
  create(@Body() createChatDto: CreateChatDto, @Req() req: RequestWithCookies) {
    return this.chatsService.createDirectChat(req.user.id, createChatDto.memberId);
  }

  @ApiOperation({ summary: 'Получить список участников чата' })
  @ApiResponse({ status: 200, description: 'Список участников чата' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @UseGuards(AuthGuard)
  @Get(':id/members')
  getChatMembers(@Param('id') chatId: string) {
    return this.chatsService.getChatMembers(chatId);
  }

  @ApiOperation({ summary: 'Добавить участника в групповой чат' })
  @ApiResponse({ status: 204, description: 'Участник добавлен' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @UseGuards(AuthGuard)
  @Post(':id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addMember(@Param('id') chatId: string, @Body() dto: AddChatMemberDto): Promise<void> {
    await this.chatsService.addMemberToGroup(chatId, dto.userId);
  }

  @ApiOperation({ summary: 'Удалить участника из группового чата' })
  @ApiResponse({ status: 204, description: 'Участник удалён' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @UseGuards(AuthGuard)
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(@Param('id') chatId: string, @Param('userId') userId: string): Promise<void> {
    await this.chatsService.removeMemberFromGroup(chatId, Number(userId));
  }

  @ApiOperation({ summary: 'Удалить чат' })
  @ApiResponse({ status: 204, description: 'Чат удалён' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteChat(@Param('id') chatId: string, @Req() req: RequestWithCookies): Promise<void> {
    await this.chatsService.deleteChat(chatId, req.user.id);
  }

  @ApiOperation({ summary: 'Получить список чатов текущего пользователя' })
  @ApiResponse({ status: 200, description: 'Список чатов пользователя' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiOkResponse({ type: [ChatListItemDto] })
  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: RequestWithCookies) {
    return this.chatsService.findAllForUser(req.user.id);
  }

  @ApiOperation({ summary: 'Получить сообщения чата с пагинацией' })
  @ApiResponse({ status: 200, description: 'Сообщения чата и метаданные пагинации' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @ApiOkResponse({ type: ChatMessagesResponseDto })
  @UseGuards(AuthGuard)
  @Get(':id/messages')
  async findChatMessages(
    @Param('id') id: string,
    @Req() req: RequestWithCookies,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<ChatMessagesResponseDto> {
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const limitNum = limit ? parseInt(limit, 10) : 30;
    return await this.chatsService.findChatWithMessages(id, offsetNum, limitNum, req.user.id);
  }

  @ApiOperation({ summary: 'Отметить сообщения чата как прочитанные' })
  @ApiResponse({ status: 204, description: 'Сообщения отмечены как прочитанные' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @Post(':id/read')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markMessagesAsRead(@Param('id') chatId: string, @Req() req: RequestWithCookies): Promise<void> {
    const userId = String(req.user.id);
    await this.chatsService.markMessagesAsRead(chatId, userId);
  }

  @ApiOperation({ summary: 'Отправить сообщение в чат' })
  @ApiResponse({ status: 201, description: 'Сообщение отправлено' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Чат не найден' })
  @ApiCreatedResponse({ type: ChatMessageDto })
  @UseGuards(AuthGuard)
  @Post(':id/messages')
  createMessage(@Param('id') id: string, @Body() createMessageDto: CreateMessageDto, @Req() req: RequestWithCookies) {
    return this.chatsService.createMessage(id, req.user.id, createMessageDto);
  }

  @ApiOperation({ summary: 'Распознать текст из аудиосообщения' })
  @ApiResponse({ status: 200, description: 'Распознанный текст аудиосообщения' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiOkResponse({ description: 'Транскрипция аудиосообщения', schema: { properties: { text: { type: 'string' } } } })
  @UseGuards(AuthGuard)
  @Post('transcribe-audio')
  transcribeAudio(@Body() dto: TranscribeAudioDto, @Req() req: RequestWithCookies) {
    return this.chatsService.transcribeAudioMessage(dto.audioUrl, req.user.id);
  }
}
