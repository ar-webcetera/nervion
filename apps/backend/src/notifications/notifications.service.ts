import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ReadNotificationContextResponse } from '@tracker/contracts';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ReadNotificationContextDto } from './dto/read-notification-context.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, DeleteResult, Repository, UpdateResult } from 'typeorm';
import { Notifications } from './entities/notification.entity';
import { Users } from '../users/entities/users.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PushService } from '../push/push.service';
import { MailService } from '../mail/mail.service';
import { MailboxService } from '../mailbox/mailbox.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notifications)
    private readonly notificationsRepository: Repository<Notifications>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly websocketGateway: WebsocketGateway,
    private readonly pushService: PushService,
    private readonly mailService: MailService,
    private readonly mailboxService: MailboxService,
  ) {}
  async create(createNotificationDto: CreateNotificationDto) {
    const recipient = await this.usersRepository.findOne({
      where: { id: createNotificationDto.recipient_id },
    });
    if (!recipient) {
      throw new HttpException(
        {
          message: [`Пользователь с id=${createNotificationDto.recipient_id} не найден`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    const data: DeepPartial<Notifications> = {
      name: createNotificationDto.name,
      recipient,
    };
    if (createNotificationDto.link) data.link = createNotificationDto.link;
    if (createNotificationDto.message) data.message = createNotificationDto.message;
    const newNotification = await this.notificationsRepository.save(data);
    this.websocketGateway.sendNotificationAdded(newNotification);
    void this.pushService.sendToUser(createNotificationDto.recipient_id, {
      title: createNotificationDto.name,
      body: createNotificationDto.message ?? '',
      url: createNotificationDto.link ?? '/',
      tag: `notification-${newNotification.id}`,
    });
    return newNotification;
  }

  async createWithEmail(createNotificationDto: CreateNotificationDto, html: string): Promise<Notifications> {
    const notification = await this.create(createNotificationDto);
    const recipientEmail = notification.recipient?.email;

    if (!recipientEmail) return notification;

    try {
      await this.mailService.sendMail(recipientEmail, notification.name, html, {
        notificationId: notification.id,
      });
    } catch (error) {
      this.logger.error(`Не удалось отправить email для уведомления ${notification.id}: ${String(error)}`);
    }

    return notification;
  }

  findByFilter(user_id: number) {
    return this.notificationsRepository.find({
      where: { recipient: { id: user_id } },
      order: {
        is_read: 'ASC',
        created_at: 'DESC',
      },
      take: 60,
    });
  }

  async findOneForUser(id: number, userId: number): Promise<Notifications> {
    const notification = await this.notificationsRepository.findOne({
      where: { id, recipient: { id: userId } },
    });
    if (!notification) {
      throw new HttpException(
        {
          message: [`Уведомление с id=${id} не найдено`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return notification;
  }

  async markAllAsRead(userId: number): Promise<UpdateResult> {
    const unreadNotifications = await this.notificationsRepository.find({
      where: { recipient: { id: userId }, is_read: false },
      select: { id: true },
    });
    const result = await this.notificationsRepository
      .createQueryBuilder()
      .update(Notifications)
      .set({ is_read: true })
      .where('recipient_id = :userId', { userId })
      .andWhere('is_read = false')
      .execute();

    await this.mailboxService.moveNotificationThreadsToTrash(
      userId,
      unreadNotifications.map((notification) => notification.id),
    );

    return result;
  }

  async markContextAsRead(userId: number, dto: ReadNotificationContextDto): Promise<ReadNotificationContextResponse> {
    const unreadNotifications = await this.notificationsRepository.find({
      where: { recipient: { id: userId }, is_read: false },
    });
    const matchedNotifications = unreadNotifications.filter((notification) =>
      this.matchesContext(notification.link, dto.task_id, dto.comment_id),
    );

    if (matchedNotifications.length === 0) {
      return { notification_ids: [] };
    }

    matchedNotifications.forEach((notification) => {
      notification.is_read = true;
    });
    const updatedNotifications = await this.notificationsRepository.save(matchedNotifications);

    updatedNotifications.forEach((notification) => {
      this.websocketGateway.sendNotificationUpdated(notification);
    });

    const notificationIds = updatedNotifications.map((notification) => notification.id);
    await this.mailboxService.moveNotificationThreadsToTrash(userId, notificationIds);

    return { notification_ids: notificationIds };
  }

  async updateForUser(id: number, userId: number, updateNotificationDto: UpdateNotificationDto): Promise<Notifications> {
    const notification = await this.findOneForUser(id, userId);
    const wasRead = notification.is_read;

    if (updateNotificationDto.is_read || updateNotificationDto.is_read === false) {
      notification.is_read = updateNotificationDto.is_read;
    }

    const updatedNotification = await this.notificationsRepository.save(notification);
    if (updatedNotification) {
      this.websocketGateway.sendNotificationUpdated(updatedNotification);
    }
    if (!wasRead && updatedNotification.is_read) {
      await this.mailboxService.moveNotificationThreadsToTrash(userId, [updatedNotification.id]);
    }
    return updatedNotification;
  }

  private matchesContext(link: string, taskId: number, commentId?: number): boolean {
    const query = link.includes('?') ? link.slice(link.indexOf('?') + 1) : link;
    const params = new URLSearchParams(query);

    if (params.get('task-id') !== String(taskId)) return false;

    const linkedCommentId = params.get('comment-id');
    return commentId === undefined ? linkedCommentId === null : linkedCommentId === String(commentId);
  }

  async removeForUser(id: number, userId: number): Promise<DeleteResult> {
    const result = await this.notificationsRepository
      .createQueryBuilder()
      .delete()
      .from(Notifications)
      .where('id = :id', { id })
      .andWhere('recipient_id = :userId', { userId })
      .execute();

    if (!result.affected) {
      throw new HttpException(
        {
          message: [`Уведомление с id=${id} не найдено`],
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return result;
  }
}
