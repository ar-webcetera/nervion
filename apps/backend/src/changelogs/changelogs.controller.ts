import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChangelogsService } from './changelogs.service';
import { CreateChangelogDto } from './dto/create-changelog.dto';
import { UpdateChangelogDto } from './dto/update-changelog.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { RequestWithCookies } from '../common/types/request';

@Controller('changelogs')
@ApiTags('Changelog')
@UseGuards(AuthGuard, RolesGuard)
export class ChangelogsController {
  constructor(private readonly changelogsService: ChangelogsService) {}

  @Get()
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Список всех changelog-ов (только admin)' })
  @ApiResponse({ status: 200, description: 'Список всех changelog-ов' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  findAll() {
    return this.changelogsService.findAll();
  }

  @Get('unseen')
  @ApiOperation({ summary: 'Непросмотренные changelog-и текущего пользователя' })
  @ApiResponse({ status: 200, description: 'Непросмотренные changelog-и пользователя' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  findUnseen(@Req() req: RequestWithCookies) {
    return this.changelogsService.findUnseen(req.user);
  }

  @Post()
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Создать changelog (только admin)' })
  @ApiResponse({ status: 201, description: 'Changelog создан' })
  @ApiResponse({ status: 400, description: 'Некорректные данные changelog-а' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  create(@Body() dto: CreateChangelogDto, @Req() req: RequestWithCookies) {
    return this.changelogsService.create(dto, req.user);
  }

  @Patch(':id')
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Обновить changelog (только admin)' })
  @ApiResponse({ status: 200, description: 'Changelog обновлён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные changelog-а' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Changelog не найден' })
  update(@Param('id') id: number, @Body() dto: UpdateChangelogDto) {
    return this.changelogsService.update(id, dto);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Отметить changelog как просмотренный' })
  @ApiResponse({ status: 201, description: 'Changelog отмечен как просмотренный' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Changelog не найден' })
  markViewed(@Param('id') id: number, @Req() req: RequestWithCookies) {
    return this.changelogsService.markViewed(id, req.user);
  }

  @Delete(':id')
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Удалить changelog (только admin)' })
  @ApiResponse({ status: 200, description: 'Changelog удалён' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Changelog не найден' })
  remove(@Param('id') id: number) {
    return this.changelogsService.remove(id);
  }
}
