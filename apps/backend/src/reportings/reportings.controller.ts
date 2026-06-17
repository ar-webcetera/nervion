import { Controller, Post, Body, UseGuards, StreamableFile, Header } from '@nestjs/common';
import { ReportingsService } from './reportings.service';
import { CreateReportingDto } from './dto/create-reporting.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';

@Controller('reportings')
@ApiTags('Отчёты')
export class ReportingsController {
  constructor(private readonly reportingsService: ReportingsService) {}

  @UseGuards(AuthGuard)
  @Post('preview')
  @ApiOperation({ summary: 'Предпросмотр отчёта по таймлогам за период' })
  @ApiResponse({ status: 201, description: 'Строки отчёта по таймлогам для предпросмотра' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  async preview(@Body() createReportingDto: CreateReportingDto) {
    return this.reportingsService.preview(createReportingDto);
  }

  @UseGuards(AuthGuard)
  @Post()
  @ApiOperation({ summary: 'Сформировать и выгрузить отчёт по таймлогам в Excel (xlsx)' })
  @ApiResponse({ status: 201, description: 'Файл отчёта в формате xlsx' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', `attachment; filename="timelogs.xlsx"`)
  async create(@Body() createReportingDto: CreateReportingDto) {
    const file = await this.reportingsService.create(createReportingDto);
    return new StreamableFile(file);
  }
}
