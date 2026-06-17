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
    save: jest.fn<Promise<Notifications>, [Partial<Notifications>]>(),
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

  beforeEach(async () => {
    updateQueryBuilder = createNotificationsUpdateQueryBuilderMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notifications), useValue: mockNotificationsRepository },
        { provide: getRepositoryToken(Users), useValue: mockUsersRepository },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
        { provide: PushService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
    mockPushService.sendToUser.mockResolvedValue();
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

  describe('markAllAsRead', () => {
    it('должен обновлять только непрочитанные уведомления конкретного пользователя', async () => {
      const result = await service.markAllAsRead(10);

      expect(updateQueryBuilder.update).toHaveBeenCalledWith(Notifications);
      expect(updateQueryBuilder.set).toHaveBeenCalledWith({ is_read: true });
      expect(updateQueryBuilder.where).toHaveBeenCalledWith('recipient_id = :userId', { userId: 10 });
      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith('is_read = false');
      expect(result).toEqual({ affected: 3 });
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
      expect(result).toBe(updatedNotification);
    });

    it('должен выбрасывать 404, если уведомление не найдено', async () => {
      mockNotificationsRepository.findOne.mockResolvedValue(null);

      await expect(service.updateForUser(1, 10, new UpdateNotificationDto())).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
