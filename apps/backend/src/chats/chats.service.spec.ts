import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Chat, ChatType } from './entities/chat.entity';
import { ChatMember, ChatMemberRole } from './entities/chat-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatMessageReadStatus } from './entities/chat-message-read-status.entity';
import { Users } from '../users/entities/users.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PushService } from '../push/push.service';
import { ROLES } from '../common/enums/roles.enum';
import { FilesService } from '../files/files.service';
import { DeepseekService } from '../deepseek/deepseek.service';
import { ConfigService } from '@nestjs/config';
import { In } from 'typeorm';

const makeQueryBuilder = (overrides: Partial<Record<string, jest.Mock>> = {}) => {
  const qb = {} as Record<string, jest.Mock>;
  const chainMethods = [
    'innerJoin',
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'offset',
    'limit',
    'insert',
    'into',
    'values',
    'onConflict',
  ];
  for (const m of chainMethods) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb['getMany'] = overrides['getMany'] ?? jest.fn().mockResolvedValue([]);
  qb['getOne'] = overrides['getOne'] ?? jest.fn().mockResolvedValue(null);
  qb['getCount'] = overrides['getCount'] ?? jest.fn().mockResolvedValue(0);
  qb['execute'] = overrides['execute'] ?? jest.fn().mockResolvedValue({});
  return qb;
};

const mockUser = (id: number): Users =>
  ({
    id,
    first_name: 'Иван',
    last_name: 'Иванов',
    patronymic: '',
    email: `user${id}@test.com`,
    photo_url: '',
    telegram_user_id: '',
    yandex_id: null,
    role: ROLES.employee,
    hashed_password: 'hashed',
    project_members: [],
    tasks_assigned: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }) as Users;

const mockChat = (id: string, type: ChatType = ChatType.Group): Chat =>
  ({
    id,
    type,
    name: 'Тестовый чат',
    members: [],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Chat;

const mockMember = (chatId: string, userId: number, role = ChatMemberRole.MEMBER): ChatMember =>
  ({
    id: `member-${chatId}-${userId}`,
    chat_id: chatId,
    user_id: userId,
    role,
    left_at: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as ChatMember;

const mockMessage = (id: string, chatId: string, senderId: string): ChatMessage =>
  ({
    id,
    chat_id: chatId,
    sender_id: senderId,
    message: { type: 'doc', content: [] },
    is_edited: false,
    is_deleted: false,
    deleted_at: null,
    reply_to_id: null,
    edited_at: null,
    author: mockUser(Number(senderId)),
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as ChatMessage;

describe('ChatsService', () => {
  let service: ChatsService;

  let chatRepo: jest.Mocked<Record<string, jest.Mock>>;
  let userRepo: jest.Mocked<Record<string, jest.Mock>>;
  let memberRepo: jest.Mocked<Record<string, jest.Mock>>;
  let messageRepo: jest.Mocked<Record<string, jest.Mock>>;
  let readStatusRepo: jest.Mocked<Record<string, jest.Mock>>;
  let wsGateway: { sendChatMessageAdded: jest.Mock; sendChatDeleted: jest.Mock };
  let filesService: { deleteFolder: jest.Mock; getRawFile: jest.Mock };
  let deepseekService: { transcribeAudio: jest.Mock };

  beforeEach(async () => {
    chatRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    userRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    };
    memberRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    messageRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    readStatusRepo = {
      count: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    wsGateway = { sendChatMessageAdded: jest.fn(), sendChatDeleted: jest.fn() };
    filesService = {
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      getRawFile: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'audio/webm',
      }),
    };
    deepseekService = { transcribeAudio: jest.fn().mockResolvedValue('Текст аудио') };
    const mockPushService = { sendToUsers: jest.fn() };
    const configValues: Record<string, string> = {
      AWS_ENDPOINT: 'https://hb.ru-msk.vkcloud-storage.ru',
      AWS_BUCKET_ID: 'webcetera',
    };
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: string) => configValues[key] ?? defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatsService,
        { provide: getRepositoryToken(Chat), useValue: chatRepo },
        { provide: getRepositoryToken(Users), useValue: userRepo },
        { provide: getRepositoryToken(ChatMember), useValue: memberRepo },
        { provide: getRepositoryToken(ChatMessage), useValue: messageRepo },
        { provide: getRepositoryToken(ChatMessageReadStatus), useValue: readStatusRepo },
        { provide: WebsocketGateway, useValue: wsGateway },
        { provide: PushService, useValue: mockPushService },
        { provide: FilesService, useValue: filesService },
        { provide: DeepseekService, useValue: deepseekService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ChatsService>(ChatsService);
  });

  describe('findAllForUser', () => {
    it('возвращает только чаты, в которых пользователь является участником', async () => {
      const userId = 1;
      const chatId = 'chat-1';
      const chat = mockChat(chatId, ChatType.Group);
      chat.members = [mockMember(chatId, userId)];

      const qb = makeQueryBuilder({ getMany: jest.fn().mockResolvedValue([chat]) });
      chatRepo.createQueryBuilder.mockReturnValue(qb);

      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.find.mockResolvedValue([]);
      readStatusRepo.count.mockResolvedValue(0);

      const result = await service.findAllForUser(userId);
      expect(result).toHaveLength(1);
      expect(result[0].chatId).toBe(chatId);
    });

    it('возвращает пустой массив если у пользователя нет чатов', async () => {
      const qb = makeQueryBuilder({ getMany: jest.fn().mockResolvedValue([]) });
      chatRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllForUser(999);
      expect(result).toEqual([]);
    });

    it('корректно подсчитывает непрочитанные сообщения', async () => {
      const userId = 1;
      const chatId = 'chat-1';
      const chat = mockChat(chatId, ChatType.Group);
      chat.members = [mockMember(chatId, userId)];

      const qb = makeQueryBuilder({ getMany: jest.fn().mockResolvedValue([chat]) });
      chatRepo.createQueryBuilder.mockReturnValue(qb);

      const incomingMessages = [mockMessage('msg-1', chatId, '2'), mockMessage('msg-2', chatId, '2')];
      messageRepo.findOne.mockResolvedValue(incomingMessages[0]);
      messageRepo.find.mockResolvedValue(incomingMessages);
      readStatusRepo.count.mockResolvedValue(1); // одно прочитано

      const result = await service.findAllForUser(userId);
      expect(result[0].unreadMessagesCount).toBe(1);
    });
  });

  describe('createGroupChat', () => {
    it('создаёт группу и назначает создателя администратором', async () => {
      const creatorId = 1;
      const chat = mockChat('chat-new', ChatType.Group);
      chatRepo.create.mockReturnValue(chat);
      chatRepo.save.mockResolvedValue(chat);

      const creatorMemberRecord = mockMember(chat.id, creatorId, ChatMemberRole.ADMIN);
      const member2Record = mockMember(chat.id, 2, ChatMemberRole.MEMBER);

      memberRepo.create.mockReturnValueOnce(creatorMemberRecord).mockReturnValueOnce(member2Record);
      memberRepo.save.mockResolvedValue([creatorMemberRecord, member2Record]);

      const result = await service.createGroupChat(creatorId, 'Тест', [2]);

      expect(result).toBe(chat);
      expect(memberRepo.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: creatorId, role: ChatMemberRole.ADMIN }));
      expect(memberRepo.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2, role: ChatMemberRole.MEMBER }));
    });

    it('не добавляет создателя дважды если он в списке участников', async () => {
      const creatorId = 1;
      const chat = mockChat('chat-new', ChatType.Group);
      chatRepo.create.mockReturnValue(chat);
      chatRepo.save.mockResolvedValue(chat);
      memberRepo.create.mockReturnValue(mockMember(chat.id, creatorId, ChatMemberRole.ADMIN));
      memberRepo.save.mockResolvedValue([]);

      await service.createGroupChat(creatorId, 'Тест', [creatorId, 2]);

      expect(memberRepo.create).toHaveBeenCalledTimes(2);
      expect(memberRepo.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: creatorId, role: ChatMemberRole.ADMIN }));
      expect(memberRepo.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2, role: ChatMemberRole.MEMBER }));
    });
  });

  describe('addMemberToGroup', () => {
    it('добавляет нового участника', async () => {
      memberRepo.findOne.mockResolvedValue(null);
      const newMember = mockMember('chat-1', 5);
      memberRepo.create.mockReturnValue(newMember);
      memberRepo.save.mockResolvedValue(newMember);

      await service.addMemberToGroup('chat-1', 5);

      expect(memberRepo.save).toHaveBeenCalledWith(newMember);
    });

    it('не добавляет участника повторно если он уже в чате', async () => {
      memberRepo.findOne.mockResolvedValue(mockMember('chat-1', 5));

      await service.addMemberToGroup('chat-1', 5);

      expect(memberRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('removeMemberFromGroup', () => {
    it('удаляет участника из чата', async () => {
      memberRepo.delete.mockResolvedValue({ affected: 1 });

      await service.removeMemberFromGroup('chat-1', 5);

      expect(memberRepo.delete).toHaveBeenCalledWith({ chat_id: 'chat-1', user_id: 5 });
    });
  });

  describe('deleteChat', () => {
    it('выбрасывает NotFoundException если чат не найден', async () => {
      chatRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteChat('missing-chat', 1)).rejects.toThrow(NotFoundException);
    });

    it('выбрасывает ForbiddenException если пользователь не участник чата', async () => {
      const chat = mockChat('chat-1');
      chat.members = [mockMember(chat.id, 2)];
      chatRepo.findOne.mockResolvedValue(chat);

      await expect(service.deleteChat(chat.id, 1)).rejects.toThrow(ForbiddenException);
    });

    it('удаляет чат, вложения, статусы прочтения и отправляет websocket-событие', async () => {
      const chat = mockChat('chat-1');
      chat.members = [mockMember(chat.id, 1), mockMember(chat.id, 2)];
      const messages = [mockMessage('msg-1', chat.id, '1'), mockMessage('msg-2', chat.id, '2')];
      chatRepo.findOne.mockResolvedValue(chat);
      messageRepo.find.mockResolvedValue(messages);
      readStatusRepo.delete.mockResolvedValue({ affected: 2 });
      chatRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteChat(chat.id, 1);

      expect(filesService.deleteFolder).toHaveBeenCalledWith(`tracker-chat/${chat.id}/`);
      expect(readStatusRepo.delete).toHaveBeenCalledWith({ message_id: In(['msg-1', 'msg-2']) });
      expect(chatRepo.delete).toHaveBeenCalledWith({ id: chat.id });
      expect(wsGateway.sendChatDeleted).toHaveBeenCalledWith(chat.id, [1, 2]);
    });

    it('не удаляет статусы прочтения если в чате нет сообщений', async () => {
      const chat = mockChat('chat-1');
      chat.members = [mockMember(chat.id, 1)];
      chatRepo.findOne.mockResolvedValue(chat);
      messageRepo.find.mockResolvedValue([]);
      chatRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteChat(chat.id, 1);

      expect(readStatusRepo.delete).not.toHaveBeenCalled();
      expect(chatRepo.delete).toHaveBeenCalledWith({ id: chat.id });
    });
  });

  describe('getChatMembers', () => {
    it('возвращает актуальный список участников после удаления', async () => {
      const chatId = 'chat-1';
      memberRepo.find.mockResolvedValue([mockMember(chatId, 1), mockMember(chatId, 2)]);
      userRepo.findBy.mockResolvedValue([mockUser(1), mockUser(2)]);

      const result = await service.getChatMembers(chatId);
      expect(result).toHaveLength(2);
      expect(result.map((u) => u.id)).toEqual([1, 2]);
    });

    it('возвращает пустой массив если участников нет', async () => {
      memberRepo.find.mockResolvedValue([]);

      const result = await service.getChatMembers('chat-empty');
      expect(result).toEqual([]);
      expect(userRepo.findBy).not.toHaveBeenCalled();
    });
  });

  describe('createDirectChat', () => {
    it('выбрасывает ConflictException при попытке создать чат с самим собой', async () => {
      await expect(service.createDirectChat(1, 1)).rejects.toThrow(ConflictException);
    });

    it('выбрасывает NotFoundException если пользователь не найден', async () => {
      userRepo.findOneBy.mockResolvedValue(null);

      await expect(service.createDirectChat(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('возвращает существующий чат если он уже есть', async () => {
      const existingChat = mockChat('existing-chat', ChatType.Direct);
      userRepo.findOneBy.mockResolvedValue(mockUser(2));

      const qb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(existingChat) });
      chatRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.createDirectChat(1, 2);
      expect(result).toBe(existingChat);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('создаёт новый чат если его ещё нет', async () => {
      const newChat = mockChat('new-chat', ChatType.Direct);
      userRepo.findOneBy.mockResolvedValue(mockUser(2));

      const qb = makeQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
      chatRepo.createQueryBuilder.mockReturnValue(qb);
      chatRepo.create.mockReturnValue(newChat);
      chatRepo.save.mockResolvedValue(newChat);
      memberRepo.create.mockReturnValue({} as ChatMember);
      memberRepo.save.mockResolvedValue([]);

      const result = await service.createDirectChat(1, 2);
      expect(result).toBe(newChat);
      expect(chatRepo.save).toHaveBeenCalledWith(newChat);
      expect(memberRepo.save).toHaveBeenCalled();
    });
  });

  describe('findChatWithMessages', () => {
    it('выбрасывает NotFoundException если чат не существует', async () => {
      chatRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findChatWithMessages('no-such-chat', 0, 30, 1)).rejects.toThrow(NotFoundException);
    });

    it('выбрасывает ForbiddenException если пользователь не участник чата', async () => {
      const chat = mockChat('chat-1');
      chatRepo.findOneBy.mockResolvedValue(chat);
      memberRepo.findOne.mockResolvedValue(null); // не участник

      await expect(service.findChatWithMessages('chat-1', 0, 30, 99)).rejects.toThrow(ForbiddenException);
    });

    it('возвращает сообщения если пользователь является участником', async () => {
      const chatId = 'chat-1';
      const userId = 1;
      const msg = mockMessage('msg-1', chatId, '2');

      chatRepo.findOneBy.mockResolvedValue(mockChat(chatId));
      memberRepo.findOne.mockResolvedValue(mockMember(chatId, userId));

      const qb = makeQueryBuilder({
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue([msg]),
      });
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findChatWithMessages(chatId, 0, 30, userId);
      expect(result.messages).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('возвращает сообщения удалённых пользователей без автора', async () => {
      const chatId = 'chat-1';
      const userId = 1;
      const msg = mockMessage('msg-1', chatId, '2');
      msg.sender_id = null;
      msg.author = null;

      chatRepo.findOneBy.mockResolvedValue(mockChat(chatId));
      memberRepo.findOne.mockResolvedValue(mockMember(chatId, userId));

      const qb = makeQueryBuilder({
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue([msg]),
      });
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findChatWithMessages(chatId, 0, 30, userId);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].author).toBeNull();
    });

    it('не проверяет членство если userId не передан (внутренний вызов)', async () => {
      const chatId = 'chat-1';
      chatRepo.findOneBy.mockResolvedValue(mockChat(chatId));

      const qb = makeQueryBuilder({
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
      });
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.findChatWithMessages(chatId, 0, 30)).resolves.toBeDefined();
      expect(memberRepo.findOne).not.toHaveBeenCalled();
    });

    it('возвращает корректную пагинацию', async () => {
      const chatId = 'chat-1';
      const userId = 1;
      chatRepo.findOneBy.mockResolvedValue(mockChat(chatId));
      memberRepo.findOne.mockResolvedValue(mockMember(chatId, userId));

      const messages = Array.from({ length: 10 }, (_, i) => mockMessage(`msg-${i}`, chatId, '2'));
      const qb = makeQueryBuilder({
        getCount: jest.fn().mockResolvedValue(50),
        getMany: jest.fn().mockResolvedValue(messages),
      });
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findChatWithMessages(chatId, 0, 10, userId);
      expect(result.meta.total).toBe(50);
      expect(result.meta.hasMore).toBe(true);
      expect(result.messages).toHaveLength(10);
    });
  });

  describe('createMessage', () => {
    it('выбрасывает NotFoundException если чат не найден', async () => {
      chatRepo.findOneBy.mockResolvedValue(null);

      await expect(service.createMessage('no-chat', 1, { message: { type: 'doc', content: [] }, senderId: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('выбрасывает NotFoundException если отправитель не найден', async () => {
      chatRepo.findOneBy.mockResolvedValue(mockChat('chat-1'));
      userRepo.findOneBy.mockResolvedValue(null);

      await expect(service.createMessage('chat-1', 999, { message: { type: 'doc', content: [] }, senderId: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('выбрасывает ForbiddenException если отправитель не участник чата', async () => {
      chatRepo.findOneBy.mockResolvedValue(mockChat('chat-1'));
      userRepo.findOneBy.mockResolvedValue(mockUser(1));
      memberRepo.findOne.mockResolvedValue(null); // не участник

      await expect(service.createMessage('chat-1', 1, { message: { type: 'doc', content: [] }, senderId: 1 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('успешно создаёт сообщение и отправляет через WebSocket', async () => {
      const chatId = 'chat-1';
      const senderId = 1;
      const msg = mockMessage('msg-new', chatId, String(senderId));

      chatRepo.findOneBy.mockResolvedValue(mockChat(chatId));
      userRepo.findOneBy.mockResolvedValue(mockUser(senderId));
      memberRepo.findOne.mockResolvedValue(mockMember(chatId, senderId));
      memberRepo.find.mockResolvedValue([]);
      messageRepo.create.mockReturnValue(msg);
      messageRepo.save.mockResolvedValue(msg);
      messageRepo.findOne.mockResolvedValue(msg);

      const result = await service.createMessage(chatId, senderId, {
        message: { type: 'doc', content: [] },
        senderId,
      });

      expect(result).toEqual({ ...msg, reply_to: null });
      expect(wsGateway.sendChatMessageAdded).toHaveBeenCalledWith({ ...msg, reply_to: null });
    });
  });

  describe('transcribeAudioMessage', () => {
    it('расшифровывает голосовое сообщение из virtual-hosted URL доступного пользователю чата', async () => {
      memberRepo.findOne.mockResolvedValue(mockMember('chat-1', 1));

      const result = await service.transcribeAudioMessage(
        'https://webcetera.hb.ru-msk.vkcloud-storage.ru/tracker-chat/chat-1/voice/voice_123.webm',
        1,
      );

      expect(filesService.getRawFile).toHaveBeenCalledWith('tracker-chat/chat-1/voice/voice_123.webm');
      expect(deepseekService.transcribeAudio).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'voice_123.webm', 'audio/webm');
      expect(result).toEqual({ text: 'Текст аудио' });
    });

    it('расшифровывает голосовое сообщение из path-style URL настроенного бакета', async () => {
      memberRepo.findOne.mockResolvedValue(mockMember('chat-1', 1));

      const result = await service.transcribeAudioMessage(
        'https://hb.ru-msk.vkcloud-storage.ru/webcetera/tracker-chat/chat-1/voice/voice_123.webm',
        1,
      );

      expect(filesService.getRawFile).toHaveBeenCalledWith('tracker-chat/chat-1/voice/voice_123.webm');
      expect(result).toEqual({ text: 'Текст аудио' });
    });

    it('расшифровывает голосовое сообщение из внутреннего storage key', async () => {
      memberRepo.findOne.mockResolvedValue(mockMember('chat-1', 1));

      const result = await service.transcribeAudioMessage('tracker-chat/chat-1/voice/voice_123.webm', 1);

      expect(filesService.getRawFile).toHaveBeenCalledWith('tracker-chat/chat-1/voice/voice_123.webm');
      expect(result).toEqual({ text: 'Текст аудио' });
    });

    it('запрещает транскрипцию аудио из чужого чата', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.transcribeAudioMessage(
          'https://webcetera.hb.ru-msk.vkcloud-storage.ru/tracker-chat/chat-1/voice/voice_123.webm',
          2,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('отклоняет URL вне настроенного S3 endpoint', async () => {
      await expect(
        service.transcribeAudioMessage('https://example.org/tracker-chat/chat-1/voice/voice_123.webm', 1),
      ).rejects.toThrow(BadRequestException);
      expect(filesService.getRawFile).not.toHaveBeenCalled();
    });

    it('отклоняет virtual-hosted URL чужого бакета', async () => {
      await expect(
        service.transcribeAudioMessage(
          'https://other-bucket.hb.ru-msk.vkcloud-storage.ru/tracker-chat/chat-1/voice/voice_123.webm',
          1,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(filesService.getRawFile).not.toHaveBeenCalled();
    });

    it('отклоняет URL с некорректным encoding в пути', async () => {
      await expect(
        service.transcribeAudioMessage('https://webcetera.hb.ru-msk.vkcloud-storage.ru/tracker-chat/chat-1/voice/%E0%A4%A', 1),
      ).rejects.toThrow(BadRequestException);
      expect(filesService.getRawFile).not.toHaveBeenCalled();
    });

    it('возвращает BadGatewayException при ошибке распознавания', async () => {
      memberRepo.findOne.mockResolvedValue(mockMember('chat-1', 1));
      deepseekService.transcribeAudio.mockRejectedValue(new Error('OpenAI connection failed'));

      await expect(
        service.transcribeAudioMessage(
          'https://webcetera.hb.ru-msk.vkcloud-storage.ru/tracker-chat/chat-1/voice/voice_123.webm',
          1,
        ),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('markMessagesAsRead', () => {
    it('ничего не делает если нет входящих сообщений', async () => {
      messageRepo.find.mockResolvedValue([]);

      await service.markMessagesAsRead('chat-1', '1');

      expect(readStatusRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('помечает входящие сообщения как прочитанные', async () => {
      const messages = [mockMessage('msg-1', 'chat-1', '2'), mockMessage('msg-2', 'chat-1', '2')];
      messageRepo.find.mockResolvedValue(messages);

      const qb = makeQueryBuilder();
      readStatusRepo.createQueryBuilder.mockReturnValue(qb);

      await service.markMessagesAsRead('chat-1', '1');

      expect(readStatusRepo.createQueryBuilder).toHaveBeenCalled();
      expect(qb.insert).toHaveBeenCalled();
    });

    it('не помечает собственные сообщения пользователя', async () => {
      messageRepo.find.mockResolvedValue([]);

      await service.markMessagesAsRead('chat-1', '2');

      expect(readStatusRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
