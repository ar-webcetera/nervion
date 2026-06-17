import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthchecksService } from './healthchecks.service';
import { CreateHealthCheckDto } from './dto/create-healthcheck.dto';
import { UpdateHealthCheckDto } from './dto/update-healthcheck.dto';
import { HealthCheck } from './entities/healthcheck.entity';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';

@Controller('healthchecks')
@ApiTags('Healthchecks')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin)
export class HealthchecksController {
  constructor(private readonly healthchecksService: HealthchecksService) {}

  @Get()
  @ApiOperation({ summary: 'Список всех healthcheck-мониторов' })
  @ApiOkResponse({ type: [HealthCheck], description: 'Список мониторов' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  findAll(): Promise<HealthCheck[]> {
    return this.healthchecksService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Создать healthcheck-монитор' })
  @ApiCreatedResponse({ type: HealthCheck, description: 'Монитор создан' })
  @ApiResponse({ status: 400, description: 'Некорректные данные монитора' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  create(@Body() dto: CreateHealthCheckDto): Promise<HealthCheck> {
    return this.healthchecksService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить healthcheck-монитор' })
  @ApiOkResponse({ type: HealthCheck, description: 'Монитор обновлён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные монитора' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Монитор не найден' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHealthCheckDto): Promise<HealthCheck> {
    return this.healthchecksService.update(id, dto);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Включить или выключить монитор' })
  @ApiOkResponse({ type: HealthCheck, description: 'Состояние монитора изменено' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Монитор не найден' })
  toggle(@Param('id', ParseIntPipe) id: number): Promise<HealthCheck> {
    return this.healthchecksService.toggle(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить healthcheck-монитор' })
  @ApiNoContentResponse({ description: 'Монитор удалён' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Монитор не найден' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.healthchecksService.remove(id);
  }
}
