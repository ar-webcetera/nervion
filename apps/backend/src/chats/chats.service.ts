import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Users } from '../users/entities/users.entity';
import { Chat, ChatType } from './entities/chat.entity';
import { ChatListItemDto } from './dto/chat-list-item.dto';
import { ChatMember, ChatMemberRole } from './entities/chat-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatMessageReadStatus } from './entities/chat-message-read-status.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { ChatMessagesResponseDto, MessageReplyPreviewDto } from './dto/chat-messages-response.dto';
import { extractPlainText } from 'src/common/utils/extractPlainText';
import { PushService } from '../push/push.service';
import { FilesService } from '../files/files.service';
import { DeepseekService } from '../deepseek/deepseek.service';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    @InjectRepository(Chat) private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Users) private readonly userRepository: Repository<Users>,
    @InjectRepository(ChatMember) private readonly chatMemberRepository: Repository<ChatMember>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatMessageReadStatus)
    private readonly readStatusRepository: Repository<ChatMessageReadStatus>,
    private readonly websocketGateway: WebsocketGateway,
    private readonly pushService: PushService,
    private readonly filesService: FilesService,
    private readonly deepseekService: DeepseekService,
    private readonly configService: ConfigService,
  ) {}

  async findAllForUser(currentUserId: number): Promise<ChatListItemDto[]> {
    const chats = await this.chatRepository
      .createQueryBuilder('chat')
      .innerJoin('chat.members', 'member', 'member.user_id = :currentUserId', { currentUserId: String(currentUserId) })
      .leftJoinAndSelect('chat.members', 'allMembers')
      .getMany();

    const chatListItems = await Promise.all(
      chats.map(async (chat) => {
        let chatName: string;
        let memberId: number | undefined;
        let avatarUrl: string | undefined;

        if (chat.type === ChatType.Direct) {
          const otherMember = chat.members.find((m) => m.user_id !== currentUserId);
          if (!otherMember) return null;

          const user = await this.userRepository.findOne({ where: { id: otherMember.user_id } });
          if (!user) return null;

          chatName = `${user.last_name} ${user.first_name}`.trim();
          memberId = user.id;
          avatarUrl = user.photo_url || undefined;
        } else {
          chatName = chat.name || 'Группа';
        }

        const lastMessage = await this.messageRepository.findOne({
          where: { chat_id: chat.id },
          order: { createdAt: 'DESC' },
        });

        let unreadMessagesCount = 0;
        const incomingMessages = await this.messageRepository.find({
          where: { chat_id: chat.id, sender_id: Not(String(currentUserId)) },
          select: ['id'],
        });

        if (incomingMessages.length > 0) {
          const incomingMessageIds = incomingMessages.map((msg) => msg.id);
          const readCount = await this.readStatusRepository.count({
            where: {
              message_id: In(incomingMessageIds),
              user_id: String(currentUserId),
            },
          });
          unreadMessagesCount = incomingMessages.length - readCount;
        }

        return {
          chatId: chat.id,
          type: chat.type,
          memberId,
          chatName,
          avatarUrl,
          lastMessage: extractPlainText(lastMessage?.message, 80) || null,
          lastMessageDate: lastMessage?.createdAt,
          unreadMessagesCount,
        };
      }),
    ).then((items) => items.filter((item) => item !== null));

    chatListItems.sort((a, b) => {
      if (!a.lastMessageDate) return 1;
      if (!b.lastMessageDate) return -1;
      return b.lastMessageDate.getTime() - a.lastMessageDate.getTime();
    });
    return chatListItems;
  }

  async createGroupChat(creatorId: number, name: string, memberIds: number[]): Promise<Chat> {
    const chat = this.chatRepository.create({ type: ChatType.Group, name });
    await this.chatRepository.save(chat);

    const creatorMember = this.chatMemberRepository.create({
      chat_id: chat.id,
      user_id: creatorId,
      role: ChatMemberRole.ADMIN,
    });
    const otherMembers = memberIds
      .filter((id) => id !== creatorId)
      .map((id) =>
        this.chatMemberRepository.create({
          chat_id: chat.id,
          user_id: id,
          role: ChatMemberRole.MEMBER,
        }),
      );

    await this.chatMemberRepository.save([creatorMember, ...otherMembers]);
    return chat;
  }

  async getChatMembers(chatId: string): Promise<Users[]> {
    const members = await this.chatMemberRepository.find({ where: { chat_id: chatId } });
    const userIds = members.map((m) => m.user_id);
    if (userIds.length === 0) return [];
    return this.userRepository.findBy({ id: In(userIds) });
  }

  async addMemberToGroup(chatId: string, userId: number): Promise<void> {
    const existing = await this.chatMemberRepository.findOne({
      where: { chat_id: chatId, user_id: userId },
    });
    if (existing) return;

    const member = this.chatMemberRepository.create({
      chat_id: chatId,
      user_id: userId,
      role: ChatMemberRole.MEMBER,
    });
    await this.chatMemberRepository.save(member);
  }

  async removeMemberFromGroup(chatId: string, userId: number): Promise<void> {
    await this.chatMemberRepository.delete({ chat_id: chatId, user_id: userId });
  }

  async deleteChat(chatId: string, currentUserId: number): Promise<void> {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId },
      relations: ['members'],
    });

    if (!chat) {
      throw new NotFoundException(`Чат с ID "${chatId}" не найден.`);
    }

    const memberIds = chat.members.map((member) => member.user_id);
    if (!memberIds.includes(currentUserId)) {
      throw new ForbiddenException('У вас нет доступа к этому чату.');
    }

    const messages = await this.messageRepository.find({
      where: { chat_id: chatId },
      select: ['id'],
    });
    const messageIds = messages.map((message) => message.id);

    if (messageIds.length > 0) {
      await this.readStatusRepository.delete({ message_id: In(messageIds) });
    }

    await this.filesService.deleteFolder(`tracker-chat/${chatId}/`);
    await this.chatRepository.delete({ id: chatId });
    this.websocketGateway.sendChatDeleted(chatId, memberIds);
  }

  async createDirectChat(currentUserId: number, memberId: number): Promise<Chat> {
    if (currentUserId === memberId) {
      throw new ConflictException('Вы не можете создать чат с самим собой.');
    }

    const member = await this.userRepository.findOneBy({ id: memberId });
    if (!member) {
      throw new NotFoundException('Пользователь не найден.');
    }

    const existingChat = await this.chatRepository
      .createQueryBuilder('chat')
      .innerJoin('chat.members', 'member1', 'member1.user_id = :currentUserId', { currentUserId })
      .innerJoin('chat.members', 'member2', 'member2.user_id = :memberId', { memberId })
      .where('chat.type = :type', { type: 'direct' })
      .getOne();

    if (existingChat) {
      return existingChat;
    }

    const newChat = this.chatRepository.create({ type: ChatType.Direct });
    await this.chatRepository.save(newChat);

    const currentUserMember = this.chatMemberRepository.create({ chat_id: newChat.id, user_id: currentUserId });
    const otherUserMember = this.chatMemberRepository.create({ chat_id: newChat.id, user_id: memberId });

    await this.chatMemberRepository.save([currentUserMember, otherUserMember]);

    return newChat;
  }

  async createMessage(chatId: string, senderId: number, createMessageDto: CreateMessageDto): Promise<ChatMessage | null> {
    const chat = await this.chatRepository.findOneBy({ id: chatId });
    if (!chat) {
      throw new NotFoundException(`Чат с ID "${chatId}" не найден.`);
    }

    const sender = await this.userRepository.findOneBy({ id: senderId });
    if (!sender) {
      throw new NotFoundException(`Пользователь с ID "${senderId}" не найден.`);
    }

    const membership = await this.chatMemberRepository.findOne({ where: { chat_id: chatId, user_id: senderId } });
    if (!membership) {
      throw new ForbiddenException('Вы не являетесь участником этого чата.');
    }

    if (createMessageDto.reply_to_id) {
      const replyTarget = await this.messageRepository.findOne({
        where: { id: createMessageDto.reply_to_id, chat_id: chatId },
        select: ['id'],
      });
      if (!replyTarget) {
        throw new BadRequestException('Сообщение для ответа не найдено в этом чате.');
      }
    }

    const newMessage = this.messageRepository.create({
      ...createMessageDto,
      chat_id: chatId,
      sender_id: String(senderId),
    });

    await this.messageRepository.save(newMessage);
    const message = await this.messageRepository.findOne({
      where: { id: newMessage.id },
      relations: ['author'],
    });
    if (!message) {
      throw new NotFoundException(`Сообщение с ID "${newMessage.id}" не найдено.`);
    }
    const messageWithReply = await this.attachReplyPreview(message);
    this.websocketGateway.sendChatMessageAdded(messageWithReply);

    // Push-уведомления остальным участникам чата
    const members = await this.chatMemberRepository.find({ where: { chat_id: chatId } });
    const recipientIds = members.map((m) => m.user_id).filter((id) => id !== senderId);
    if (recipientIds.length > 0) {
      const body = extractPlainText(message.message as Parameters<typeof extractPlainText>[0], 100) || 'Новое сообщение';
      void this.pushService.sendToUsers(recipientIds, {
        title: `${sender.first_name} ${sender.last_name}`,
        body,
        url: `/chat?chatId=${chatId}`,
        tag: `message-${message.id}`,
      });
    }

    return messageWithReply;
  }

  private async loadReplyPreviews(ids: string[]): Promise<Map<string, MessageReplyPreviewDto>> {
    const map = new Map<string, MessageReplyPreviewDto>();
    if (ids.length === 0) {
      return map;
    }

    const rows = await this.messageRepository.find({ where: { id: In(ids) }, relations: ['author'] });
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        is_deleted: row.is_deleted,
        author: row.author ? { id: row.author.id, first_name: row.author.first_name, last_name: row.author.last_name } : null,
        snippet: row.is_deleted ? '' : extractPlainText(row.message as Parameters<typeof extractPlainText>[0], 80) || '',
      });
    }
    return map;
  }

  private async attachReplyPreview(message: ChatMessage): Promise<ChatMessage & { reply_to: MessageReplyPreviewDto | null }> {
    const previews = await this.loadReplyPreviews(message.reply_to_id ? [message.reply_to_id] : []);
    return {
      ...message,
      reply_to: message.reply_to_id ? (previews.get(message.reply_to_id) ?? null) : null,
    };
  }

  async sendSystemMessage(chatId: string, senderId: number, message: object): Promise<void> {
    const newMessage = this.messageRepository.create({
      message,
      chat_id: chatId,
      sender_id: String(senderId),
    });
    await this.messageRepository.save(newMessage);
    const saved = await this.messageRepository.findOne({
      where: { id: newMessage.id },
      relations: ['author'],
    });
    if (saved) {
      this.websocketGateway.sendChatMessageAdded(saved);
    }
  }

  async markMessagesAsRead(chatId: string, userId: string): Promise<void> {
    const messages = await this.messageRepository.find({
      where: { chat_id: chatId, sender_id: Not(userId) },
      select: ['id'],
    });

    if (!messages.length) {
      return;
    }

    const messageIds = messages.map((msg) => msg.id);

    const readStatuses = messageIds.map((messageId) => ({
      user_id: userId,
      message_id: messageId,
    }));

    await this.readStatusRepository
      .createQueryBuilder()
      .insert()
      .into(ChatMessageReadStatus)
      .values(readStatuses)
      .onConflict(`("user_id", "message_id") DO NOTHING`)
      .execute();
  }

  async transcribeAudioMessage(audioUrl: string, currentUserId: number): Promise<{ text: string }> {
    const storageKey = this.getChatVoiceStorageKey(audioUrl);
    const chatId = storageKey.split('/')[1];

    const membership = await this.chatMemberRepository.findOne({ where: { chat_id: chatId, user_id: currentUserId } });
    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому аудиосообщению.');
    }

    let file: Awaited<ReturnType<FilesService['getRawFile']>>;
    try {
      file = await this.filesService.getRawFile(storageKey);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Не удалось получить аудиофайл для транскрипции ${storageKey}: ${message}`);
      throw new BadGatewayException('Не удалось получить аудиофайл для транскрипции.');
    }

    const fileName = storageKey.split('/').pop() || 'audio.webm';
    let text: string;
    try {
      text = await this.deepseekService.transcribeAudio(Buffer.from(file.body), fileName, file.contentType);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Не удалось распознать аудиофайл ${storageKey}: ${message}`);
      throw new BadGatewayException('Не удалось распознать аудиосообщение.');
    }
    return { text };
  }

  private getChatVoiceStorageKey(audioUrl: string): string {
    if (!/^https?:\/\//i.test(audioUrl)) {
      return this.normalizeChatVoiceStorageKey(audioUrl);
    }

    let parsedAudioUrl: URL;
    let parsedStorageEndpoint: URL;

    try {
      parsedAudioUrl = new URL(audioUrl);
      parsedStorageEndpoint = new URL(this.configService.get<string>('AWS_ENDPOINT', 'https://s3.timeweb.cloud'));
    } catch {
      throw new BadRequestException('Некорректный URL аудиофайла.');
    }

    const bucketId = this.configService.get<string>('AWS_BUCKET_ID');
    if (!this.isAllowedChatVoiceStorageUrl(parsedAudioUrl, parsedStorageEndpoint, bucketId)) {
      throw new BadRequestException('Аудиофайл должен находиться в настроенном S3-хранилище.');
    }

    const storageKey = this.extractChatVoiceStorageKey(parsedAudioUrl, bucketId);

    return this.normalizeChatVoiceStorageKey(storageKey);
  }

  private normalizeChatVoiceStorageKey(storageKey: string): string {
    let normalizedStorageKey: string;
    try {
      normalizedStorageKey = decodeURIComponent(storageKey.replace(/^\/+/, ''));
    } catch {
      throw new BadRequestException('Некорректный путь аудиофайла.');
    }

    if (!/^tracker-chat\/[^/]+\/voice\/[^/]+$/.test(normalizedStorageKey)) {
      throw new BadRequestException('Некорректный путь аудиофайла.');
    }

    return normalizedStorageKey;
  }

  private isAllowedChatVoiceStorageUrl(audioUrl: URL, storageEndpoint: URL, bucketId?: string): boolean {
    if (audioUrl.origin === storageEndpoint.origin) {
      return true;
    }

    if (!bucketId) {
      return false;
    }

    return (
      audioUrl.protocol === storageEndpoint.protocol &&
      audioUrl.hostname === `${bucketId}.${storageEndpoint.hostname}` &&
      audioUrl.port === storageEndpoint.port
    );
  }

  private extractChatVoiceStorageKey(audioUrl: URL, bucketId?: string): string {
    const pathWithoutLeadingSlash = audioUrl.pathname.replace(/^\/+/, '');

    if (!bucketId) {
      return pathWithoutLeadingSlash;
    }

    const [firstSegment, ...restSegments] = pathWithoutLeadingSlash.split('/');
    if (firstSegment && firstSegment === encodeURIComponent(bucketId) && restSegments.length > 0) {
      return restSegments.join('/');
    }

    return pathWithoutLeadingSlash;
  }

  async findChatWithMessages(
    chatId: string,
    offset: number = 0,
    limit: number = 30,
    userId?: number,
  ): Promise<ChatMessagesResponseDto> {
    const chatExists = await this.chatRepository.findOneBy({ id: chatId });
    if (!chatExists) {
      throw new NotFoundException(`Чат с ID "${chatId}" не найден.`);
    }

    if (userId !== undefined) {
      const membership = await this.chatMemberRepository.findOne({ where: { chat_id: chatId, user_id: userId } });
      if (!membership) {
        throw new ForbiddenException('У вас нет доступа к этому чату.');
      }
    }

    const total = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.chat_id = :chatId', { chatId })
      .getCount();

    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.author', 'author')
      .where('message.chat_id = :chatId', { chatId })
      .orderBy('message.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getMany();

    const replyIds = [...new Set(messages.map((m) => m.reply_to_id).filter((id): id is string => Boolean(id)))];
    const replyPreviews = await this.loadReplyPreviews(replyIds);

    return {
      messages: messages.map((msg) => ({
        id: msg.id,
        message: msg.message,
        createdAt: msg.createdAt,
        author: msg.author,
        reply_to_id: msg.reply_to_id,
        reply_to: msg.reply_to_id ? (replyPreviews.get(msg.reply_to_id) ?? null) : null,
      })),
      meta: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    };
  }
}
