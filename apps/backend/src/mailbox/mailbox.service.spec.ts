import { PayloadTooLargeException } from '@nestjs/common';
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
import { MailDeliveryService } from './mail-delivery.service';
import { PushService } from '../push/push.service';
import { InboundMailData } from './mailbox.types';
import { Users } from '../users/entities/users.entity';

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
  getMany: jest.Mock;
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
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb;
};

describe('MailboxService', () => {
  let service: MailboxService;
  let messagesQueryBuilder: MessagesQueryBuilderMock;
  let notificationsQueryBuilder: MessagesQueryBuilderMock;
  let usersQueryBuilder: MessagesQueryBuilderMock;

  const mockAccountsRepository = {
    findOne: jest.fn(),
  };

  const mockThreadsRepository = {
    create: jest.fn((value: Partial<MailThreads>) => value),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockMessagesRepository = {
    create: jest.fn((value: Partial<MailMessages>) => value),
    find: jest.fn(),
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

  const mockUsersRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockStorageService = {
    uploadObject: jest.fn(),
    getObjectStream: jest.fn(),
  };

  const mockPostboxService = {
    send: jest.fn(),
  };
  const mockMailDeliveryService = {
    attachDeliverySummaries: jest.fn().mockResolvedValue(new Map()),
    getStats: jest.fn(),
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
    usersQueryBuilder = createMessagesQueryBuilderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailboxService,
        { provide: getRepositoryToken(MailAccounts), useValue: mockAccountsRepository },
        { provide: getRepositoryToken(MailThreads), useValue: mockThreadsRepository },
        { provide: getRepositoryToken(MailMessages), useValue: mockMessagesRepository },
        { provide: getRepositoryToken(MailAttachments), useValue: mockAttachmentsRepository },
        { provide: getRepositoryToken(Notifications), useValue: mockNotificationsRepository },
        { provide: getRepositoryToken(Users), useValue: mockUsersRepository },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PostboxService, useValue: mockPostboxService },
        { provide: MailDeliveryService, useValue: mockMailDeliveryService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PushService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get(MailboxService);
    jest.clearAllMocks();

    mockMessagesRepository.createQueryBuilder.mockImplementation(() => messagesQueryBuilder);
    mockNotificationsRepository.createQueryBuilder.mockImplementation(() => notificationsQueryBuilder);
    mockUsersRepository.createQueryBuilder.mockImplementation(() => usersQueryBuilder);
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
    it('должен отправлять новое письмо именно с выбранного ящика', async () => {
      const selectedAccount = {
        id: 2,
        address: 'l.pavlova@webcetera.test',
        display_name: 'Лилия Павлова',
        allowedUsers: [{ id: 10 }],
      } as MailAccounts;
      const thread = {
        id: 3,
        account_id: selectedAccount.id,
        subject: 'Тема письма',
      } as MailThreads;

      mockAccountsRepository.findOne.mockResolvedValue(selectedAccount);
      mockThreadsRepository.save.mockResolvedValue(thread);
      mockMessagesRepository.save.mockImplementation((message: Partial<MailMessages>) => Promise.resolve(message));
      mockPostboxService.send.mockResolvedValue({
        messageId: 'sent-message-id@webcetera.test',
        providerMessageId: 'QA_provider_1',
      });

      await service.sendMail({ id: 10, role: 'employee' } as never, {
        account_id: selectedAccount.id,
        to: ['client@example.com'],
        subject: 'Тема письма',
        text: 'Текст',
      });

      expect(mockPostboxService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: {
            address: selectedAccount.address,
            name: selectedAccount.display_name,
          },
        }),
      );
      expect(mockMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          from_address: selectedAccount.address,
          from_name: selectedAccount.display_name,
          message_id: 'sent-message-id@webcetera.test',
          provider_message_id: 'QA_provider_1',
          delivery_status: 'sent',
        }),
      );
    });

    it('должен возвращать отправленное сообщение вместе с сохранёнными вложениями', async () => {
      const selectedAccount = {
        id: 2,
        address: 'l.pavlova@webcetera.test',
        display_name: 'Лилия Павлова',
        allowedUsers: [{ id: 10 }],
      } as MailAccounts;
      const thread = { id: 3, account_id: selectedAccount.id, subject: 'Тема письма' } as MailThreads;
      const attachment = {
        s3_key: 'mailbox/outbound/archive.7z',
        filename: 'Документы.7z',
        content_type: 'application/x-7z-compressed',
        size: 3_290_279,
      };
      const savedAttachment = { id: 44, message_id: 12, ...attachment } as MailAttachments;

      mockAccountsRepository.findOne.mockResolvedValue(selectedAccount);
      mockThreadsRepository.save.mockResolvedValue(thread);
      mockMessagesRepository.save.mockImplementation((message: Partial<MailMessages>) => Promise.resolve({ id: 12, ...message }));
      mockStorageService.getObjectStream.mockResolvedValue({ body: {} });
      mockAttachmentsRepository.save.mockResolvedValue([savedAttachment]);
      mockPostboxService.send.mockResolvedValue({
        messageId: 'sent-message-id@webcetera.test',
        providerMessageId: 'QA_provider_2',
      });

      const result = await service.sendMail({ id: 10, role: 'employee' } as never, {
        account_id: selectedAccount.id,
        to: ['client@example.com'],
        subject: 'Тема письма',
        attachments: [attachment],
      });

      expect(result.attachments).toEqual([savedAttachment]);
    });

    it('должен отклонять слишком большие вложения до обращения к Postbox', async () => {
      mockAccountsRepository.findOne.mockResolvedValue({
        id: 2,
        address: 'l.pavlova@webcetera.test',
        allowedUsers: [{ id: 10 }],
      });

      await expect(
        service.sendMail({ id: 10, role: 'employee' } as never, {
          account_id: 2,
          to: ['client@example.com'],
          subject: 'Тема письма',
          attachments: [
            {
              s3_key: 'mailbox/outbound/archive.7z',
              filename: 'Документы.7z',
              content_type: 'application/x-7z-compressed',
              size: 7_000_001,
            },
          ],
        }),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(mockPostboxService.send).not.toHaveBeenCalled();
    });

    it('должен возвращать понятную ошибку, если Postbox отклонил размер готового письма', async () => {
      mockAccountsRepository.findOne.mockResolvedValue({
        id: 2,
        address: 'l.pavlova@webcetera.test',
        allowedUsers: [{ id: 10 }],
      });
      mockPostboxService.send.mockRejectedValue(new Error('MessageRejected: message is too big (message size quota exceeded)'));

      await expect(
        service.sendMail({ id: 10, role: 'employee' } as never, {
          account_id: 2,
          to: ['client@example.com'],
          subject: 'Тема письма',
        }),
      ).rejects.toThrow('Вложения занимают больше 7 МБ');
    });

    it('должен отклонять слишком большие вложения при отправке черновика', async () => {
      mockMessagesRepository.findOne.mockResolvedValue({
        id: 9,
        status: MAIL_MESSAGE_STATUSES.draft,
        subject: 'Тема письма',
        text_body: 'Текст',
        html_body: null,
        to_addresses: [{ address: 'client@example.com' }],
        cc_addresses: [],
        attachments: [{ size: 7_000_001 }],
        thread: {
          id: 3,
          account: { id: 1, address: 'mail@webcetera.test', allowedUsers: [{ id: 10 }] },
        },
      });

      await expect(service.sendDraft({ id: 10, role: 'employee' } as never, 9)).rejects.toThrow('Вложения занимают больше 7 МБ');
      expect(mockPostboxService.send).not.toHaveBeenCalled();
    });

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

    it('должен менять ящик отправителя при обновлении черновика', async () => {
      const previousAccount = {
        id: 1,
        address: 'info@webcetera.test',
        display_name: 'Info',
        allowedUsers: [{ id: 10 }],
      } as MailAccounts;
      const selectedAccount = {
        id: 2,
        address: 'l.pavlova@webcetera.test',
        display_name: 'Лилия Павлова',
        allowedUsers: [{ id: 10 }],
      } as MailAccounts;
      const thread = {
        id: 3,
        account_id: previousAccount.id,
        account: previousAccount,
        subject: '(черновик)',
        counterparty_address: null,
      } as MailThreads;
      const draft = {
        id: 9,
        status: MAIL_MESSAGE_STATUSES.draft,
        from_address: previousAccount.address,
        from_name: previousAccount.display_name,
        thread,
      } as MailMessages;
      mockAccountsRepository.findOne.mockResolvedValue(selectedAccount);
      mockMessagesRepository.findOne.mockResolvedValue(draft);

      await service.saveDraft({ id: 10, role: 'employee' } as never, {
        account_id: selectedAccount.id,
        draft_id: draft.id,
        to: ['client@example.com'],
        subject: 'Тема письма',
      });

      expect(mockThreadsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ account_id: selectedAccount.id, account: selectedAccount }),
      );
      expect(mockMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          from_address: selectedAccount.address,
          from_name: selectedAccount.display_name,
        }),
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
      mockPostboxService.send.mockResolvedValue({
        messageId: 'sent@test',
        providerMessageId: 'QA_provider_draft',
      });

      await service.sendDraft({ id: 10, role: 'employee' } as never, 9);

      expect(mockThreadsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Итоговая тема' }));
      expect(mockMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MAIL_MESSAGE_STATUSES.sent,
          message_id: 'sent@test',
          provider_message_id: 'QA_provider_draft',
          delivery_status: 'sent',
        }),
      );
    });
  });

  describe('uploadOutboundAttachment', () => {
    it('должен восстанавливать UTF-8 в имени загружаемого файла', async () => {
      const filename = 'Договор на разработку.pdf';
      const file = {
        originalname: Buffer.from(filename, 'utf8').toString('latin1'),
        mimetype: 'application/pdf',
        buffer: Buffer.from('pdf'),
        size: 3,
      } as Express.Multer.File;

      const attachment = await service.uploadOutboundAttachment(file);

      expect(attachment.filename).toBe(filename);
      expect(attachment.s3_key).toMatch(/^mailbox\/outbound\/[0-9a-f-]+-Договор_на_разработку\.pdf$/);
      expect(mockStorageService.uploadObject).toHaveBeenCalledWith(attachment.s3_key, file.buffer, 'application/pdf');
    });
  });

  describe('avatars', () => {
    it('должен добавлять аватар пользователя при совпадении email без учёта регистра', async () => {
      mockThreadsRepository.findOne.mockResolvedValue({
        id: 3,
        counterparty_address: 'L.Pavlova@Example.com',
        account: { id: 1, allowedUsers: [{ id: 10 }] },
      });
      mockMessagesRepository.find.mockResolvedValue([
        {
          id: 9,
          thread_id: 3,
          from_address: 'l.pavlova@example.com',
        },
      ]);
      usersQueryBuilder.getMany.mockResolvedValue([
        {
          email: 'l.pavlova@example.com',
          photo_url: 'https://cdn.test/lilia.jpg',
        },
      ]);

      const result = await service.getThreadWithMessages({ id: 10, role: 'employee' } as never, 3);

      expect(usersQueryBuilder.where).toHaveBeenCalledWith('LOWER(user.email) IN (:...addresses)', {
        addresses: ['l.pavlova@example.com'],
      });
      expect(result.thread.counterparty_avatar_url).toBe('https://cdn.test/lilia.jpg');
      expect(result.messages[0].sender_avatar_url).toBe('https://cdn.test/lilia.jpg');
    });
  });

  describe('getUnreadCounts', () => {
    it('должен возвращать count как входящие и значения по папкам', async () => {
      messagesQueryBuilder.getRawMany.mockResolvedValue([
        { folder: MAIL_FOLDERS.inbox, count: '4' },
        { folder: MAIL_FOLDERS.trash, count: '2' },
      ]);

      await expect(service.getUnreadCounts({ id: 10 } as never)).resolves.toEqual({
        count: 4,
        inbox: 4,
        trash: 2,
      });
      expect(messagesQueryBuilder.groupBy).toHaveBeenCalledWith('thread.folder');
    });
  });
});
