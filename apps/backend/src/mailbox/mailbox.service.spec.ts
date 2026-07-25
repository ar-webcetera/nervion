import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In } from 'typeorm';
import { MailboxService } from './mailbox.service';
import { MailAccounts } from './entities/mail-account.entity';
import { MailThreads, MAIL_FOLDERS } from './entities/mail-thread.entity';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailAttachments } from './entities/mail-attachment.entity';
import { Notifications } from '../notifications/entities/notification.entity';
import { StorageService } from '../storage/storage.service';
import { PostboxService } from './postbox.service';
import { PushService } from '../push/push.service';
import { InboundMailData } from './mailbox.types';

type MessagesQueryBuilderMock = {
  createQueryBuilder: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  innerJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  groupBy: jest.Mock;
  getOne: jest.Mock;
  getRawMany: jest.Mock;
};

const createMessagesQueryBuilderMock = (): MessagesQueryBuilderMock => {
  const qb = {} as MessagesQueryBuilderMock;
  qb.createQueryBuilder = jest.fn(() => qb);
  qb.select = jest.fn(() => qb);
  qb.addSelect = jest.fn(() => qb);
  qb.innerJoin = jest.fn(() => qb);
  qb.innerJoinAndSelect = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.groupBy = jest.fn(() => qb);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb;
};

describe('MailboxService', () => {
  let service: MailboxService;
  let messagesQueryBuilder: MessagesQueryBuilderMock;
  let notificationsQueryBuilder: MessagesQueryBuilderMock;

  const mockAccountsRepository = {
    findOne: jest.fn(),
  };

  const mockThreadsRepository = {
    create: jest.fn((value: Partial<MailThreads>) => value),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockMessagesRepository = {
    create: jest.fn((value: Partial<MailMessages>) => value),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockAttachmentsRepository = {
    create: jest.fn((value: Partial<MailAttachments>) => value),
    delete: jest.fn(),
    save: jest.fn(),
  };

  const mockNotificationsRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockStorageService = {
    uploadObject: jest.fn(),
  };

  const mockPostboxService = {
    send: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn(),
  };
  const mockPushService = {
    sendToUser: jest.fn(),
  };

  const baseInbound = (): InboundMailData => ({
    messageId: '<msg-1@test>',
    notificationId: 15,
    inReplyTo: null,
    referencesHeader: null,
    from: { address: 'sender@example.com', name: 'Sender' },
    to: [{ address: 'user@webcetera.test' }],
    cc: [],
    subject: 'Вам назначена задача',
    text: 'Текст',
    html: '<p>Текст</p>',
    rawS3Key: 'raw/key',
    authResults: null,
    attachments: [],
  });

  beforeEach(async () => {
    messagesQueryBuilder = createMessagesQueryBuilderMock();
    notificationsQueryBuilder = createMessagesQueryBuilderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailboxService,
        { provide: getRepositoryToken(MailAccounts), useValue: mockAccountsRepository },
        { provide: getRepositoryToken(MailThreads), useValue: mockThreadsRepository },
        { provide: getRepositoryToken(MailMessages), useValue: mockMessagesRepository },
        { provide: getRepositoryToken(MailAttachments), useValue: mockAttachmentsRepository },
        { provide: getRepositoryToken(Notifications), useValue: mockNotificationsRepository },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PostboxService, useValue: mockPostboxService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PushService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get(MailboxService);
    jest.clearAllMocks();

    mockMessagesRepository.createQueryBuilder.mockImplementation(() => messagesQueryBuilder);
    mockNotificationsRepository.createQueryBuilder.mockImplementation(() => notificationsQueryBuilder);
    mockThreadsRepository.create.mockImplementation((value: Partial<MailThreads>) => value);
    mockMessagesRepository.create.mockImplementation((value: Partial<MailMessages>) => value);
    mockThreadsRepository.save.mockImplementation((value: Partial<MailThreads>) =>
      Promise.resolve({
        id: 3,
        folder: MAIL_FOLDERS.inbox,
        ...value,
      }),
    );
    mockMessagesRepository.save.mockImplementation((value: Partial<MailMessages>) =>
      Promise.resolve({
        id: 9,
        ...value,
      }),
    );
    mockAccountsRepository.findOne.mockResolvedValue({
      id: 1,
      address: 'user@webcetera.test',
      allowedUsers: [{ id: 10 }],
    });
  });

  describe('ingestInbound', () => {
    it('должен связывать письмо с уведомлением только при совпадении email ящика', async () => {
      notificationsQueryBuilder.getOne.mockResolvedValue({
        id: 15,
        is_read: false,
        recipient: { id: 10, email: 'user@webcetera.test' },
      });

      const account = { id: 1, address: 'user@webcetera.test' } as MailAccounts;
      const message = await service.ingestInbound(account, baseInbound());

      expect(notificationsQueryBuilder.andWhere).toHaveBeenCalledWith('LOWER(recipient.email) = :accountAddress', {
        accountAddress: 'user@webcetera.test',
      });
      expect(mockMessagesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_id: 15,
          is_read: false,
          status: MAIL_MESSAGE_STATUSES.received,
          direction: MAIL_DIRECTIONS.inbound,
        }),
      );
      expect(message?.notification_id).toBe(15);
      expect(mockThreadsRepository.save).toHaveBeenCalledWith(expect.not.objectContaining({ folder: MAIL_FOLDERS.trash }));
    });

    it('не должен связывать письмо, если email ящика не совпадает с получателем уведомления', async () => {
      notificationsQueryBuilder.getOne.mockResolvedValue(null);

      const account = { id: 2, address: 'other@webcetera.test' } as MailAccounts;
      await service.ingestInbound(account, baseInbound());

      expect(mockMessagesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_id: null,
          is_read: false,
        }),
      );
    });

    it('должен сразу класть письмо в корзину, если уведомление уже прочитано', async () => {
      notificationsQueryBuilder.getOne.mockResolvedValue({
        id: 15,
        is_read: true,
        recipient: { id: 10, email: 'user@webcetera.test' },
      });

      const account = { id: 1, address: 'user@webcetera.test' } as MailAccounts;
      await service.ingestInbound(account, baseInbound());

      expect(mockMessagesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_id: 15,
          is_read: true,
        }),
      );
      expect(mockThreadsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ folder: MAIL_FOLDERS.trash }));
    });
  });

  describe('moveNotificationThreadsToTrash', () => {
    it('должен помечать inbound письма прочитанными и переносить треды в корзину', async () => {
      messagesQueryBuilder.getRawMany.mockResolvedValue([{ thread_id: 3 }, { thread_id: '4' }]);

      const threadIds = await service.moveNotificationThreadsToTrash(10, [15, 16]);

      expect(threadIds).toEqual([3, 4]);
      expect(mockMessagesRepository.update).toHaveBeenCalledWith(
        {
          thread_id: In([3, 4]),
          direction: MAIL_DIRECTIONS.inbound,
          is_read: false,
        },
        { is_read: true },
      );
      expect(mockThreadsRepository.update).toHaveBeenCalledWith({ id: In([3, 4]) }, { folder: MAIL_FOLDERS.trash });
    });

    it('должен возвращать пустой список без обновлений, если писем нет', async () => {
      const threadIds = await service.moveNotificationThreadsToTrash(10, []);

      expect(threadIds).toEqual([]);
      expect(mockMessagesRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockThreadsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('drafts', () => {
    it('должен обновлять заголовок треда при сохранении черновика', async () => {
      const thread = {
        id: 3,
        subject: '(черновик)',
        counterparty_address: null,
        account: { id: 1, allowedUsers: [{ id: 10 }] },
      } as MailThreads;
      mockMessagesRepository.findOne.mockResolvedValue({
        id: 9,
        status: MAIL_MESSAGE_STATUSES.draft,
        thread,
      });

      await service.saveDraft({ id: 10, role: 'employee' } as never, {
        account_id: 1,
        draft_id: 9,
        to: ['client@example.com'],
        subject: 'Тема письма',
      });

      expect(mockThreadsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Тема письма', counterparty_address: 'client@example.com' }),
      );
    });

    it('должен заменить временный заголовок треда после отправки черновика', async () => {
      const thread = {
        id: 3,
        subject: '(черновик)',
        account: {
          id: 1,
          address: 'user@webcetera.test',
          display_name: 'User',
          allowedUsers: [{ id: 10 }],
        },
      } as MailThreads;
      mockMessagesRepository.findOne.mockResolvedValue({
        id: 9,
        status: MAIL_MESSAGE_STATUSES.draft,
        subject: 'Итоговая тема',
        text_body: 'Текст',
        html_body: null,
        to_addresses: [{ address: 'client@example.com' }],
        cc_addresses: [],
        attachments: [],
        thread,
      });
      mockPostboxService.send.mockResolvedValue('<sent@test>');

      await service.sendDraft({ id: 10, role: 'employee' } as never, 9);

      expect(mockThreadsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Итоговая тема' }));
      expect(mockMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: MAIL_MESSAGE_STATUSES.sent, message_id: '<sent@test>' }),
      );
    });
  });

  describe('getUnreadCounts', () => {
    it('должен возвращать общее число и значения по папкам', async () => {
      messagesQueryBuilder.getRawMany.mockResolvedValue([
        { folder: MAIL_FOLDERS.inbox, count: '4' },
        { folder: MAIL_FOLDERS.trash, count: '2' },
      ]);

      await expect(service.getUnreadCounts({ id: 10 } as never)).resolves.toEqual({
        count: 6,
        inbox: 4,
        trash: 2,
      });
      expect(messagesQueryBuilder.groupBy).toHaveBeenCalledWith('thread.folder');
    });
  });
});
