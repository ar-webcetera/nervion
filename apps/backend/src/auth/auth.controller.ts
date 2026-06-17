import { Controller, Post, Body, Res, Req, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LoginEmailDto } from './dto/login-email.dto';
import { AuthGuard } from './guards/auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GetMeResponseDto } from './dto/get-me-response.dto';
import { RequestWithCookies } from '../common/types/request';

@Controller('auth')
@ApiTags('Авторизация')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/login/email')
  @ApiOperation({ summary: 'Вход по email' })
  @ApiBody({ type: LoginEmailDto })
  @ApiResponse({ status: 200, description: 'Успешный вход', type: Boolean })
  @ApiResponse({ status: 401, description: 'Неверный пароль' })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  @ApiResponse({ status: 500, description: 'Непредвиденная ошибка' })
  async loginByEmail(@Body() loginEmailDto: LoginEmailDto, @Res() res: Response, @Req() req: RequestWithCookies) {
    return await this.authService.loginByEmail(loginEmailDto, res, req.hostname);
  }

  @Get('/demo')
  @ApiOperation({ summary: 'Демо-вход (включается флагом DEMO_AUTH_ENABLED)' })
  @ApiResponse({ status: 302, description: 'Редирект в приложение под демо-пользователем' })
  @ApiResponse({ status: 404, description: 'Демо-вход выключен' })
  demoLogin(@Res() res: Response, @Req() req: RequestWithCookies) {
    return this.authService.demoLogin(res, req.hostname);
  }

  @UseGuards(AuthGuard)
  @ApiResponse({
    status: 200,
    description: 'Данные текущего пользователя',
    type: GetMeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  @Get('/me')
  getMe(@Req() req: RequestWithCookies, @Res({ passthrough: true }) res: Response) {
    this.authService.renewCookie(req.user, res);
    return {
      id: req.user.id,
      role: req.user.role,
      photo_url: req.user.photo_url,
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      email: req.user.email,
      telegram_user_id: req.user.telegram_user_id,
      hidden_menu_items: req.user.hidden_menu_items ?? [],
      created_at: req.user.createdAt,
      updated_at: req.user.updatedAt,
      patronymic: req.user.patronymic,
    };
  }

  @Patch('/password')
  async changePassword(@Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.changePassword(changePasswordDto);
  }

  @Post('/logout')
  @ApiOperation({ summary: 'Выход из системы' })
  @ApiResponse({ status: 200, description: 'Успешный выход' })
  @UseGuards(AuthGuard)
  logout(@Req() req: RequestWithCookies, @Res() res: Response) {
    return this.authService.logout(req.user, res, req.hostname);
  }
}
