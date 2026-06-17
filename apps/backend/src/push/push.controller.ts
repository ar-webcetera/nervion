import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PushService } from './push.service';
import { SaveSubscriptionDto } from './dto/save-subscription.dto';
import { RemoveSubscriptionDto } from './dto/remove-subscription.dto';
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
}
