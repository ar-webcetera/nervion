import { Controller, Post, Body, UseGuards, StreamableFile, Header, Get, Patch, Param, Query, Req } from '@nestjs/common';
import { ReportingsService } from './reportings.service';
import { CreateReportingDto } from './dto/create-reporting.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { ReviewBillingDto } from './dto/review-billing.dto';
import { UpsertMonthlyTargetDto } from './dto/upsert-monthly-target.dto';
import { RequestWithCookies } from '../common/types/request';

@Controller('reportings')
@ApiTags('Отчёты')
export class ReportingsController {
  constructor(private readonly reportingsService: ReportingsService) {}

  @Get('revenue/dashboard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  dashboard(@Req() req: RequestWithCookies) {
    return this.reportingsService.getRevenueDashboard(req.user.id);
  }

  @Get('billing/count')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  pendingCount(@Req() req: RequestWithCookies) {
    return this.reportingsService.getPendingCount(req.user.id);
  }

  @Get('billing/items')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  billingItems(
    @Req() req: RequestWithCookies,
    @Query('pending') pending?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const parsedOffset = Math.max(0, Number(offset) || 0);
    return this.reportingsService.getBillingItems(req.user.id, pending !== 'false', parsedLimit, parsedOffset);
  }

  @Patch('billing/timelogs/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  async reviewTimelog(@Param('id') id: string, @Body() dto: ReviewBillingDto, @Req() req: RequestWithCookies) {
    await this.reportingsService.reviewTimelog(Number(id), dto, req.user.id);
    return { success: true };
  }

  @Patch('billing/fixed/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  async reviewFixed(@Param('id') id: string, @Body() dto: ReviewBillingDto, @Req() req: RequestWithCookies) {
    await this.reportingsService.reviewFixedRevenue(Number(id), dto, req.user.id);
    return { success: true };
  }

  @Patch('revenue/target')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  async target(@Body() dto: UpsertMonthlyTargetDto, @Req() req: RequestWithCookies) {
    await this.reportingsService.upsertMonthlyTarget(dto.year, dto.month, dto.amount, req.user.id);
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @Post('preview')
  @ApiOperation({ summary: 'Предпросмотр отчёта по таймлогам за период' })
  @ApiResponse({ status: 201, description: 'Строки отчёта по таймлогам для предпросмотра' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  async preview(@Body() createReportingDto: CreateReportingDto, @Req() req: RequestWithCookies) {
    return this.reportingsService.preview(createReportingDto, req.user.id);
  }

  @UseGuards(AuthGuard)
  @Post()
  @ApiOperation({ summary: 'Сформировать и выгрузить отчёт по таймлогам в Excel (xlsx)' })
  @ApiResponse({ status: 201, description: 'Файл отчёта в формате xlsx' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', `attachment; filename="timelogs.xlsx"`)
  async create(@Body() createReportingDto: CreateReportingDto, @Req() req: RequestWithCookies) {
    const file = await this.reportingsService.create(createReportingDto, req.user.id);
    return new StreamableFile(file);
  }
}
