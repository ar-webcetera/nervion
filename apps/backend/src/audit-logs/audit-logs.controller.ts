import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES } from '../common/enums/roles.enum';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { AuditLogsService } from './audit-logs.service';
import { RequestWithCookies } from '../common/types/request';

@Controller('audit-logs')
@ApiTags('Audit Logs')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'Получить журнал аудита с фильтрами' })
  @ApiResponse({ status: 200, description: 'Записи журнала аудита (постранично)' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  findAll(@Query() query: GetAuditLogsDto, @Req() req: RequestWithCookies) {
    return this.auditLogsService.findAll(query, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить запись журнала аудита по ID' })
  @ApiResponse({ status: 200, description: 'Запись журнала аудита' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Запись не найдена' })
  async findOne(@Param('id') id: string, @Req() req: RequestWithCookies) {
    const item = await this.auditLogsService.findOne(Number(id), req.user);
    if (!item) {
      throw new NotFoundException(`Audit log #${id} не найден`);
    }
    return item;
  }
}
