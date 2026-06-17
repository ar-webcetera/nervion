import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { Request } from 'express';
import { WorkSchedulesService } from './work-schedules.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { GetWorkSchedulesDto } from './dto/get-work-schedules.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@ApiTags('Графики работы')
@Controller('work-schedules')
@UseGuards(AuthGuard, RolesGuard)
export class WorkSchedulesController {
  constructor(private readonly service: WorkSchedulesService) {}

  @Post()
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Создать запись графика работы' })
  @ApiResponse({ status: 201, description: 'Запись графика создана' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  create(@Body() dto: CreateWorkScheduleDto, @Req() req: RequestWithUser) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получить список записей графика работы с фильтрами' })
  @ApiResponse({ status: 200, description: 'Список записей графика' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  findAll(@Query() filters: GetWorkSchedulesDto, @Req() req: RequestWithUser) {
    return this.service.findAll(filters, req.user);
  }

  @Get('users')
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получить список сотрудников, доступных текущему пользователю' })
  @ApiResponse({ status: 200, description: 'Список доступных сотрудников' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  findVisibleUsers(@Req() req: RequestWithUser) {
    return this.service.findVisibleUsers(req.user);
  }

  @Get(':id')
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получить запись графика работы по идентификатору' })
  @ApiResponse({ status: 200, description: 'Данные записи графика' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  @ApiResponse({ status: 404, description: 'Запись графика не найдена' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Обновить запись графика работы' })
  @ApiResponse({ status: 200, description: 'Запись графика обновлена' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Нельзя редактировать график другого сотрудника' })
  @ApiResponse({ status: 404, description: 'Запись графика не найдена' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkScheduleDto, @Req() req: RequestWithUser) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Удалить запись графика работы' })
  @ApiResponse({ status: 200, description: 'Запись графика удалена' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Нельзя удалить график другого сотрудника' })
  @ApiResponse({ status: 404, description: 'Запись графика не найдена' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.service.remove(id, req.user);
  }
}
