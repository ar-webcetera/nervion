import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CreateTimelogDto } from './dto/create-timelog.dto';
import { GetTimelogByFilterDto } from './dto/get-timelog-by-filter.dto';
import { GetTimelogSummaryDto } from './dto/get-timelog-summary.dto';
import { UpdateTimelogDto } from './dto/update-timelog.dto';
import { TimelogsService } from './timelogs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Controller('timelogs')
@ApiTags('Таймлоги')
export class TimelogsController {
  constructor(private readonly timelogsService: TimelogsService) {}
  @Post()
  @ApiOperation({ summary: 'Создание таймлога' })
  @UseGuards(AuthGuard)
  @ApiResponse({
    status: 201,
    description: 'Таймлог успешно создан',
  })
  async createTimelog(@Body() createTimelogDto: CreateTimelogDto, @Req() request: RequestWithUser) {
    return this.timelogsService.createTimelog(createTimelogDto, request.user);
  }

  @Get('/tasks/:task_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Получение таймлогов по фильтрам' })
  @ApiResponse({
    status: 201,
    description: 'Таймлоги успешно выгружены',
  })
  @ApiResponse({
    status: 200,
    description: 'Проекты успешно получены',
    schema: {
      example: {
        timelogs: [
          {
            id: 147,
            status: 'completed',
            time_spent: '19496',
            summary: 'Добавил прототипы блоков с этапами работы, прайсом, сопутствующими услугами, FAQ, "Оставить заявку"',
            change_status_at: '1753967944952',
            created_at: '2025-07-31T05:53:16.949Z',
            updated_at: '2025-07-31T12:19:04.964Z',
          },
        ],
        totalTimeSpent: '01:30:00',
      },
    },
  })
  async findByTask(@Param('task_id') task_id: number) {
    return this.timelogsService.findByTask(task_id);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Получение таймлогов по фильтрам' })
  @ApiResponse({
    status: 200,
    description: 'Таймлоги успешно получены',
    schema: {
      example: [
        {
          id: 147,
          status: 'completed',
          time_spent: '19496',
          summary: 'Добавил прототипы блоков с этапами работы, прайсом, сопутствующими услугами, FAQ, "Оставить заявку"',
          change_status_at: '1753967944952',
          created_at: '2025-07-31T05:53:16.949Z',
          updated_at: '2025-07-31T12:19:04.964Z',
        },
      ],
    },
  })
  async findByFilter(@Query() getTimelogByFilterDto: GetTimelogByFilterDto) {
    return this.timelogsService.findByFilter(getTimelogByFilterDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновление таймлога' })
  @UseGuards(AuthGuard)
  @ApiResponse({
    status: 201,
    description: 'Таймлог успешно создан',
  })
  async updateTimelog(@Body() updateTimelogDto: UpdateTimelogDto, @Param('id') id: number, @Req() request: RequestWithUser) {
    return this.timelogsService.updateTimelog(id, updateTimelogDto, request.user);
  }

  @Get('/report/work-hours')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Получение отчета по выработке часов специалистами' })
  @ApiResponse({
    status: 200,
    description: 'Отчет успешно сформирован',
  })
  async getWorkHoursBySpecialistReport(@Res() res: Response) {
    const buffer: Buffer = await this.timelogsService.getWorkHoursBySpecialistReport();
    const formattedDate = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    const filename = `work-hours-report-${formattedDate}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  }

  @Get('/summary')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Получение сводки по таймлогам с группировкой по проектам и пользователям' })
  @ApiResponse({
    status: 200,
    description: 'Сводка успешно получена',
  })
  async getSummary(@Query() filters: GetTimelogSummaryDto, @Req() request: RequestWithUser) {
    return this.timelogsService.getSummary(filters, request.user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удаление таймлога' })
  @UseGuards(AuthGuard)
  @ApiResponse({
    status: 201,
    description: 'Таймлог успешно удален',
  })
  async deleteTimelog(@Param('id') id: number, @Req() request: RequestWithUser) {
    return this.timelogsService.deleteTimelog(id, request.user);
  }
}
