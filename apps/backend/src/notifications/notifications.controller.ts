import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequestWithCookies } from '../common/types/request';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { ReadNotificationContextDto } from './dto/read-notification-context.dto';

@Controller('notifications')
@ApiTags('Уведомления')
@UseGuards(AuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @ApiOperation({ summary: 'Создание уведомления (только администратор)' })
  @ApiResponse({ status: 201, description: 'Уведомление создано' })
  @ApiResponse({ status: 400, description: 'Некорректные данные уведомления' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав для создания уведомления' })
  @Roles(ROLES.admin)
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получение уведомлений текущего пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Уведомления успешно получены',
  })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  findByFilter(@Req() req: RequestWithCookies) {
    return this.notificationsService.findByFilter(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получение уведомления по идентификатору' })
  @ApiResponse({ status: 200, description: 'Уведомление получено' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Уведомление не найдено' })
  findOne(@Param('id') id: string, @Req() req: RequestWithCookies) {
    return this.notificationsService.findOneForUser(+id, req.user.id);
  }

  @Patch('/mark-all-read')
  @ApiOperation({ summary: 'Отметить все уведомления прочитанными' })
  @ApiResponse({ status: 200, description: 'Все уведомления отмечены прочитанными' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  markAllAsRead(@Req() req: RequestWithCookies) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  @Patch('/read-context')
  @ApiOperation({ summary: 'Отметить уведомления прочитанными по открытой задаче или просмотренному комментарию' })
  @ApiResponse({ status: 200, description: 'Подходящие уведомления отмечены прочитанными' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  markContextAsRead(@Req() req: RequestWithCookies, @Body() dto: ReadNotificationContextDto) {
    return this.notificationsService.markContextAsRead(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновление уведомления по идентификатору' })
  @ApiResponse({ status: 200, description: 'Уведомление обновлено' })
  @ApiResponse({ status: 400, description: 'Некорректные данные уведомления' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Уведомление не найдено' })
  update(@Param('id') id: string, @Body() updateNotificationDto: UpdateNotificationDto, @Req() req: RequestWithCookies) {
    return this.notificationsService.updateForUser(+id, req.user.id, updateNotificationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удаление уведомления по идентификатору' })
  @ApiResponse({ status: 200, description: 'Уведомление удалено' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Уведомление не найдено' })
  remove(@Param('id') id: string, @Req() req: RequestWithCookies) {
    return this.notificationsService.removeForUser(+id, req.user.id);
  }
}
