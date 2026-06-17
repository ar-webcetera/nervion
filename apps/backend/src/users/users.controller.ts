import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequestWithCookies } from 'src/common/types/request';

@Controller('users')
@ApiTags('Пользователи')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Получение всех пользователей' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Список слушателей с группировкой по школам',
    content: {
      'application/json': {
        schema: {
          example: [
            {
              name: 'Сергеев Егор',
              specialization: 'backend',
              grade: 'junior',
              cost: 600,
            },
            {
              name: 'Сионин Максим',
              specialization: 'tester',
              grade: 'junior',
              cost: 500,
            },
            {
              name: 'Берхеев Динар',
              specialization: 'frontend',
              grade: 'middle',
              cost: 1200,
            },
            {
              name: 'Иван Иванов',
              specialization: 'team_lead',
              grade: 'senior',
              cost: 2200,
            },
          ],
        },
      },
    },
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Get()
  getUsersByFilter(@Req() req: RequestWithCookies) {
    return this.usersService.getUsersByFilter(req.user.id, req.user);
  }

  @ApiOperation({ summary: 'Создание нового пользователя' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Пользователь создан' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Некорректные данные пользователя' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Недостаточно прав для создания пользователя' })
  @UseGuards(AuthGuard, RolesGuard)
  @Post()
  createUser(@Body() body: CreateUserDto, @Req() req: RequestWithCookies) {
    return this.usersService.createUser(body, req.user);
  }

  @ApiOperation({ summary: 'Получение архивных пользователей' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Список архивных пользователей' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Недостаточно прав' })
  @UseGuards(AuthGuard, RolesGuard)
  @Get('archived')
  getArchivedUsers() {
    return this.usersService.getArchivedUsers();
  }

  @ApiOperation({ summary: 'Обновление настроек скрытых пунктов меню текущего пользователя' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Настройки меню обновлены' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @UseGuards(AuthGuard, RolesGuard)
  @Patch('menu-settings')
  updateMenuSettings(@Body('hidden_menu_items') hidden: string[], @Req() req: RequestWithCookies) {
    return this.usersService.updateMenuSettings(req.user.id, hidden ?? []);
  }

  @ApiOperation({ summary: 'Обновление пользователя по идентификатору' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Данные пользователя обновлены' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Некорректные данные пользователя' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Недостаточно прав для редактирования пользователя' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Пользователь не найден' })
  @UseGuards(AuthGuard, RolesGuard)
  @Patch(':id')
  updateUser(@Param('id') id: number, @Body() body: UpdateUserDto, @Req() req: RequestWithCookies) {
    return this.usersService.updateUser(id, body, req.user);
  }

  @ApiOperation({ summary: 'Архивирование пользователя по идентификатору' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Пользователь перемещён в архив' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Недостаточно прав для архивирования пользователя' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Пользователь не найден' })
  @UseGuards(AuthGuard, RolesGuard)
  @Delete(':id')
  archiveUser(@Param('id') id: number, @Req() req: RequestWithCookies) {
    return this.usersService.archiveUser(id, req.user);
  }

  @ApiOperation({ summary: 'Восстановление пользователя из архива' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Пользователь восстановлен из архива' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Недостаточно прав для восстановления пользователя' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Пользователь не найден' })
  @UseGuards(AuthGuard, RolesGuard)
  @Patch(':id/restore')
  restoreUser(@Param('id') id: number, @Req() req: RequestWithCookies) {
    return this.usersService.restoreUser(id, req.user);
  }
}
