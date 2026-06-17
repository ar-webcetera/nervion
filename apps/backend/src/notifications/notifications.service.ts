import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, DeleteResult, Repository, UpdateResult } from 'typeorm';
import { Notifications } from './entities/notification.entity';
import { Users } from '../users/entities/users.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PushService } from '../push/push.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notifications)
    private readonly notificationsRepository: Repository<Notifications>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly websocketGateway: WebsocketGateway,
    private readonly pushService: PushService,
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
    return this.notificationsRepository
      .createQueryBuilder()
      .update(Notifications)
      .set({ is_read: true })
      .where('recipient_id = :userId', { userId })
      .andWhere('is_read = false')
      .execute();
  }

  async updateForUser(id: number, userId: number, updateNotificationDto: UpdateNotificationDto): Promise<Notifications> {
    const notification = await this.findOneForUser(id, userId);

    if (updateNotificationDto.is_read || updateNotificationDto.is_read === false) {
      notification.is_read = updateNotificationDto.is_read;
    }

    const updatedNotification = await this.notificationsRepository.save(notification);
    if (updatedNotification) {
      this.websocketGateway.sendNotificationUpdated(updatedNotification);
    }
    return updatedNotification;
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
