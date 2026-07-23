import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { Users } from '../users/entities/users.entity';
import { Notifications } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PushService } from '../push/push.service';
import { MailService } from '../mail/mail.service';
import { MailboxService } from '../mailbox/mailbox.service';
import { ReadNotificationContextDto } from './dto/read-notification-context.dto';

type NotificationsUpdateQueryBuilderMock = {
  update: jest.Mock<NotificationsUpdateQueryBuilderMock, [typeof Notifications]>;
  set: jest.Mock<NotificationsUpdateQueryBuilderMock, [Partial<Notifications>]>;
  where: jest.Mock<NotificationsUpdateQueryBuilderMock, [string, Record<string, unknown>]>;
  andWhere: jest.Mock<NotificationsUpdateQueryBuilderMock, [string]>;
  execute: jest.Mock<Promise<{ affected: number }>, []>;
};

const createNotificationsUpdateQueryBuilderMock = (): NotificationsUpdateQueryBuilderMock => {
  const qb = {} as NotificationsUpdateQueryBuilderMock;
  qb.update = jest.fn<NotificationsUpdateQueryBuilderMock, [typeof Notifications]>(() => qb);
  qb.set = jest.fn<NotificationsUpdateQueryBuilderMock, [Partial<Notifications>]>(() => qb);
  qb.where = jest.fn<NotificationsUpdateQueryBuilderMock, [string, Record<string, unknown>]>(() => qb);
  qb.andWhere = jest.fn<NotificationsUpdateQueryBuilderMock, [string]>(() => qb);
  qb.execute = jest.fn<Promise<{ affected: number }>, []>().mockResolvedValue({ affected: 3 });
  return qb;
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let updateQueryBuilder: NotificationsUpdateQueryBuilderMock;

  const mockNotificationsRepository = {
    save: jest.fn<Promise<Notifications | Notifications[]>, [Partial<Notifications> | Partial<Notifications>[]]>(),
    find: jest.fn<Promise<Notifications[]>, [object]>(),
    findOne: jest.fn<Promise<Notifications | null>, [object]>(),
    delete: jest.fn<Promise<{ affected: number }>, [number]>(),
    createQueryBuilder: jest.fn<NotificationsUpdateQueryBuilderMock, []>(),
  };

  const mockUsersRepository = {
    findOne: jest.fn<Promise<Users | null>, [object]>(),
  };

  const mockWebsocketGateway = {
    sendNotificationAdded: jest.fn(),
    sendNotificationUpdated: jest.fn(),
  };

  const mockPushService = {
    sendToUser: jest.fn<Promise<void>, [number, object]>().mockResolvedValue(),
  };
  const mockMailService = {
    sendMail: jest.fn<Promise<void>, [string, string, string, { notificationId: number }]>().mockResolvedValue(),
  };
  const mockMailboxService = {
    moveNotificationThreadsToTrash: jest.fn<Promise<number[]>, [number, number[]]>().mockResolvedValue([]),
  };

  beforeEach(async () => {
    updateQueryBuilder = createNotificationsUpdateQueryBuilderMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notifications), useValue: mockNotificationsRepository },
        { provide: getRepositoryToken(Users), useValue: mockUsersRepository },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
        { provide: PushService, useValue: mockPushService },
        { provide: MailService, useValue: mockMailService },
        { provide: MailboxService, useValue: mockMailboxService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
    mockPushService.sendToUser.mockResolvedValue();
    mockMailService.sendMail.mockResolvedValue();
    mockMailboxService.moveNotificationThreadsToTrash.mockResolvedValue([]);
    mockNotificationsRepository.createQueryBuilder.mockReturnValue(updateQueryBuilder);
  });

  describe('create', () => {
    it('должен создавать уведомление и запускать websocket/push', async () => {
      const recipient = { id: 4 } as Users;
      const saved = { id: 1, is_read: false, recipient } as Notifications;
      const dto = Object.assign(new CreateNotificationDto(), {
        name: 'Новое уведомление',
        message: 'Текст',
        recipient_id: 4,
        link: '/tasks/1',
      });

      mockUsersRepository.findOne.mockResolvedValue(recipient);
      mockNotificationsRepository.save.mockResolvedValue(saved);

      const result = await service.create(dto);

      expect(mockNotificationsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Новое уведомление',
          message: 'Текст',
          recipient,
          link: '/tasks/1',
        }),
      );
      expect(mockWebsocketGateway.sendNotificationAdded).toHaveBeenCalledWith(saved);
      expect(mockPushService.sendToUser).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          title: 'Новое уведомление',
          body: 'Текст',
          url: '/tasks/1',
        }),
      );
      expect(result).toBe(saved);
    });

    it('должен выбрасывать 404, если получатель не найден', async () => {
      mockUsersRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          Object.assign(new CreateNotificationDto(), {
            name: 'Новое уведомление',
            message: 'Текст',
            recipient_id: 4,
          }),
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('createWithEmail', () => {
    it('должен отправлять email с X-Nervion-Notification-Id через notificationId', async () => {
      const recipient = { id: 4, email: 'user@webcetera.test' } as Users;
      const saved = { id: 42, is_read: false, name: 'Вам назначена задача', recipient } as Notifications;

      mockUsersRepository.findOne.mockResolvedValue(recipient);
      mockNotificationsRepository.save.mockResolvedValue(saved);

      const result = await service.createWithEmail(
        Object.assign(new CreateNotificationDto(), {
          name: 'Вам назначена задача',
          message: 'Текст',
          recipient_id: 4,
          link: '?task-id=12',
        }),
        '<p>HTML</p>',
      );

      expect(mockMailService.sendMail).toHaveBeenCalledWith('user@webcetera.test', 'Вам назначена задача', '<p>HTML</p>', {
        notificationId: 42,
      });
      expect(result).toBe(saved);
    });

    it('не должен отправлять email, если у получателя нет адреса', async () => {
      const recipient = { id: 4 } as Users;
      const saved = { id: 42, is_read: false, name: 'Уведомление', recipient } as Notifications;

      mockUsersRepository.findOne.mockResolvedValue(recipient);
      mockNotificationsRepository.save.mockResolvedValue(saved);

      await service.createWithEmail(
        Object.assign(new CreateNotificationDto(), {
          name: 'Уведомление',
          recipient_id: 4,
        }),
        '<p>HTML</p>',
      );

      expect(mockMailService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('должен обновлять только непрочитанные уведомления конкретного пользователя', async () => {
      mockNotificationsRepository.find.mockResolvedValue([{ id: 2 }, { id: 3 }] as Notifications[]);

      const result = await service.markAllAsRead(10);

      expect(updateQueryBuilder.update).toHaveBeenCalledWith(Notifications);
      expect(updateQueryBuilder.set).toHaveBeenCalledWith({ is_read: true });
      expect(updateQueryBuilder.where).toHaveBeenCalledWith('recipient_id = :userId', { userId: 10 });
      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith('is_read = false');
      expect(mockMailboxService.moveNotificationThreadsToTrash).toHaveBeenCalledWith(10, [2, 3]);
      expect(result).toEqual({ affected: 3 });
    });
  });

  describe('markContextAsRead', () => {
    it('должен читать только уведомление открытой задачи без comment-id', async () => {
      const taskNotification = { id: 1, link: '?task-id=12', is_read: false } as Notifications;
      const commentNotification = { id: 2, link: '?task-id=12&comment-id=5', is_read: false } as Notifications;
      const otherTaskNotification = { id: 3, link: '?task-id=123', is_read: false } as Notifications;
      mockNotificationsRepository.find.mockResolvedValue([taskNotification, commentNotification, otherTaskNotification]);
      mockNotificationsRepository.save.mockResolvedValue([taskNotification]);

      const result = await service.markContextAsRead(10, Object.assign(new ReadNotificationContextDto(), { task_id: 12 }));

      expect(mockNotificationsRepository.save).toHaveBeenCalledWith([expect.objectContaining({ id: 1, is_read: true })]);
      expect(mockMailboxService.moveNotificationThreadsToTrash).toHaveBeenCalledWith(10, [1]);
      expect(result).toEqual({ notification_ids: [1] });
    });

    it('должен читать только точный комментарий указанной задачи', async () => {
      const expected = { id: 4, link: '?task-id=12&comment-id=5', is_read: false } as Notifications;
      mockNotificationsRepository.find.mockResolvedValue([
        expected,
        { id: 5, link: '?task-id=12&comment-id=50', is_read: false } as Notifications,
        { id: 6, link: '?task-id=120&comment-id=5', is_read: false } as Notifications,
      ]);
      mockNotificationsRepository.save.mockResolvedValue([expected]);

      const result = await service.markContextAsRead(
        10,
        Object.assign(new ReadNotificationContextDto(), { task_id: 12, comment_id: 5 }),
      );

      expect(result).toEqual({ notification_ids: [4] });
      expect(mockNotificationsRepository.save).toHaveBeenCalledWith([expect.objectContaining({ id: 4, is_read: true })]);
    });
  });

  describe('updateForUser', () => {
    it('должен сохранять is_read=false и отправлять websocket update', async () => {
      const notification = {
        id: 1,
        is_read: true,
        recipient: { id: 10 },
      } as Notifications;
      const updatedNotification = {
        ...notification,
        is_read: false,
      } as Notifications;

      mockNotificationsRepository.findOne.mockResolvedValue(notification);
      mockNotificationsRepository.save.mockResolvedValue(updatedNotification);

      const result = await service.updateForUser(
        1,
        10,
        Object.assign(new UpdateNotificationDto(), {
          is_read: false,
        }),
      );

      expect(mockNotificationsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          is_read: false,
        }),
      );
      expect(mockWebsocketGateway.sendNotificationUpdated).toHaveBeenCalledWith(updatedNotification);
      expect(mockMailboxService.moveNotificationThreadsToTrash).not.toHaveBeenCalled();
      expect(result).toBe(updatedNotification);
    });

    it('должен перемещать связанные письма в корзину при прочтении', async () => {
      const notification = {
        id: 7,
        is_read: false,
        recipient: { id: 10 },
      } as Notifications;
      const updatedNotification = {
        ...notification,
        is_read: true,
      } as Notifications;

      mockNotificationsRepository.findOne.mockResolvedValue(notification);
      mockNotificationsRepository.save.mockResolvedValue(updatedNotification);

      await service.updateForUser(7, 10, Object.assign(new UpdateNotificationDto(), { is_read: true }));

      expect(mockMailboxService.moveNotificationThreadsToTrash).toHaveBeenCalledWith(10, [7]);
    });

    it('должен выбрасывать 404, если уведомление не найдено', async () => {
      mockNotificationsRepository.findOne.mockResolvedValue(null);

      await expect(service.updateForUser(1, 10, new UpdateNotificationDto())).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
