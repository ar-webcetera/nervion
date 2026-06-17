import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AllocationsService } from './allocations.service';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { UpdateAllocationDto } from './dto/update-allocation.dto';
import { GetAllocationsDto } from './dto/get-allocations.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@ApiTags('Планирование/Аллокации')
@Controller('allocations')
@UseGuards(AuthGuard, RolesGuard)
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Post()
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Создать аллокацию (назначить сотрудника на проект)' })
  @ApiResponse({ status: 201, description: 'Аллокация создана' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (требуется роль администратора)' })
  create(@Body() createAllocationDto: CreateAllocationDto) {
    return this.allocationsService.create(createAllocationDto);
  }

  @Get()
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получить список аллокаций с фильтрами' })
  @ApiResponse({ status: 200, description: 'Список аллокаций' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  findAll(@Query() filters: GetAllocationsDto, @Req() request: RequestWithUser) {
    return this.allocationsService.findAll(filters, request.user);
  }

  @Get(':id')
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получить аллокацию по идентификатору' })
  @ApiResponse({ status: 200, description: 'Данные аллокации' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  @ApiResponse({ status: 404, description: 'Аллокация не найдена' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.allocationsService.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Обновить аллокацию' })
  @ApiResponse({ status: 200, description: 'Аллокация обновлена' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (требуется роль администратора)' })
  @ApiResponse({ status: 404, description: 'Аллокация не найдена' })
  update(@Param('id', ParseIntPipe) id: number, @Body() updateAllocationDto: UpdateAllocationDto) {
    return this.allocationsService.update(id, updateAllocationDto);
  }

  @Delete(':id')
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Удалить аллокацию' })
  @ApiResponse({ status: 200, description: 'Аллокация удалена' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (требуется роль администратора)' })
  @ApiResponse({ status: 404, description: 'Аллокация не найдена' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.allocationsService.remove(id);
  }
}
