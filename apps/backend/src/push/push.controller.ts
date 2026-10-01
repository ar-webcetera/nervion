import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PushService } from './push.service';
import { SaveSubscriptionDto } from './dto/save-subscription.dto';
import { RemoveSubscriptionDto } from './dto/remove-subscription.dto';
import { TestPushDto } from './dto/test-push.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequestWithCookies } from '../common/types/request';

@Controller('push')
@ApiTags('Web Push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Получить VAPID публичный ключ' })
  @ApiResponse({ status: 200, description: 'Публичный VAPID-ключ для оформления push-подписки' })
  getVapidPublicKey() {
    return { key: this.pushService.getVapidPublicKey() };
  }

  @Post('subscribe')
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Сохранить push-подписку' })
  @ApiResponse({ status: 204, description: 'Подписка сохранена' })
  @ApiResponse({ status: 400, description: 'Некорректные данные подписки' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  subscribe(@Body() dto: SaveSubscriptionDto, @Req() req: RequestWithCookies): Promise<void> {
    return this.pushService.saveSubscription(req.user.id, dto);
  }

  @Delete('unsubscribe')
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить push-подписку' })
  @ApiResponse({ status: 204, description: 'Подписка удалена' })
  @ApiResponse({ status: 400, description: 'Некорректные данные подписки' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  unsubscribe(@Body() body: RemoveSubscriptionDto, @Req() req: RequestWithCookies): Promise<void> {
    return this.pushService.removeSubscription(req.user.id, body.endpoint);
  }

  @Post('test')
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отправить тестовый push на текущее устройство' })
  @ApiResponse({ status: 204, description: 'Push-сервис принял уведомление, доставка на устройство не подтверждена' })
  @ApiResponse({ status: 404, description: 'Подписка пользователя не найдена' })
  @ApiResponse({ status: 410, description: 'Подписка истекла, требуется повторное подключение' })
  @ApiResponse({ status: 503, description: 'Push-сервис недоступен' })
  test(@Body() body: TestPushDto, @Req() req: RequestWithCookies): Promise<void> {
    return this.pushService.sendTest(req.user.id, body.endpoint);
  }
}
