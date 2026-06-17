import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { FindTasksByFilterDto } from './dto/find-tasks-by-filter.dto';
import { FindKanbanColumnDto } from './dto/find-kanban-column.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateTaskResponseDto } from './dto/create-task-response.dto';
import { UpdateTaskResponseDto } from './dto/update-task-response.dto';
import { FindTasksByFilterResponse } from './dto/find-tasks-by-filter-response.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdatePriorityTaskDto } from './dto/update-priority-task.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { GetKanbanByFilterResponse } from './dto/find-kanban-by-filter-response.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LinkExistingDto } from './dto/link-existing.dto';
import { CreateAndLinkDto } from './dto/create-and-link.dto';
import { UnlinkTaskDto } from './dto/unlink-task.dto';
import { UpdateFilterStateDto } from './dto/update-filter-state.dto';
import { UpdateKanbanColumnsDto } from './dto/update-kanban-columns.dto';
import { UpdateViewTypeDto } from './dto/update-view-type.dto';
import { GetWeeklyTasksDto } from './dto/get-weekly-tasks.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { RequestWithCookies } from '../common/types/request';

@Controller('tasks')
@ApiTags('Задачи')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);
  constructor(private readonly tasksService: TasksService) {}

  @Get('weekly')
  @ApiOperation({ summary: 'Получение повторяющихся задач по неделям' })
  @ApiResponse({ status: 200, description: 'Задачи недели успешно получены' })
  @UseGuards(AuthGuard, RolesGuard)
  async getWeeklyTasks(@Req() req: RequestWithCookies, @Query() query: GetWeeklyTasksDto) {
    return await this.tasksService.getWeeklyTasks(query.week_start, req.user, query);
  }

  @Post(':taskId/complete')
  @ApiOperation({ summary: 'Отметить повторяющуюся задачу выполненной на дату' })
  @ApiParam({ name: 'taskId', description: 'ID задачи', type: String })
  @ApiBody({ schema: { example: { date: '2026-04-07' } } })
  @ApiResponse({ status: 201, description: 'Выполнение зафиксировано' })
  @UseGuards(AuthGuard, RolesGuard)
  async completeRecurringTask(@Param('taskId') taskId: string, @Body() body: CompleteTaskDto, @Req() req: RequestWithCookies) {
    return await this.tasksService.completeRecurringTask(Number(taskId), body.date, req.user);
  }

  @Delete(':taskId/complete')
  @ApiOperation({ summary: 'Снять отметку выполнения повторяющейся задачи на дату' })
  @ApiParam({ name: 'taskId', description: 'ID задачи', type: String })
  @ApiBody({ schema: { example: { date: '2026-04-07' } } })
  @ApiResponse({ status: 200, description: 'Отметка снята' })
  @UseGuards(AuthGuard, RolesGuard)
  async uncompleteRecurringTask(@Param('taskId') taskId: string, @Body() body: CompleteTaskDto, @Req() req: RequestWithCookies) {
    return await this.tasksService.uncompleteRecurringTask(Number(taskId), body.date, req.user);
  }

  @Get('kanban')
  @ApiOperation({ summary: 'Получение историй' })
  @ApiResponse({
    status: 200,
    description: 'Истории успешно получены',
    type: GetKanbanByFilterResponse,
  })
  @UseGuards(AuthGuard, RolesGuard)
  async getKanban(@Req() req: RequestWithCookies, @Query() query: FindTasksByFilterDto) {
    return await this.tasksService.getKanban(query, req.user);
  }

  @Get('kanban/column')
  @ApiOperation({ summary: 'Догрузка карточек одной колонки канбана (по скроллу)' })
  @UseGuards(AuthGuard, RolesGuard)
  async getKanbanColumn(@Req() req: RequestWithCookies, @Query() query: FindKanbanColumnDto) {
    return await this.tasksService.getKanbanColumn(query, query.status, query.offset ?? 0, query.limit ?? 50, req.user);
  }

  @Get('')
  @ApiOperation({ summary: 'Получение задач' })
  @ApiResponse({
    status: 200,
    description: 'Задачи успешно получены',
    type: FindTasksByFilterResponse,
  })
  @UseGuards(AuthGuard, RolesGuard)
  async findTasksByFilter(@Req() req: RequestWithCookies, @Query() query: FindTasksByFilterDto) {
    return await this.tasksService.findTasksByFilter(query, req.user);
  }

  @Post('export')
  @ApiOperation({ summary: 'Экспорт задач в Excel' })
  @ApiResponse({
    status: 200,
    description: 'Excel файл успешно сгенерирован',
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="tasks.xlsx"')
  async exportTasks(@Req() req: RequestWithCookies, @Body() query: FindTasksByFilterDto) {
    const buffer = await this.tasksService.exportTasksToExcel(query, req.user);
    return new StreamableFile(buffer);
  }

  @Patch('priority/swap')
  @ApiOperation({ summary: 'Изменение приоритета задач' })
  @ApiResponse({
    status: 200,
  })
  @UseGuards(AuthGuard, RolesGuard)
  async updatePriorityTask(@Body() updatePriorityTaskDto: UpdatePriorityTaskDto) {
    return await this.tasksService.updatePriorityTask(updatePriorityTaskDto);
  }

  @Delete(':taskId/links')
  @ApiOperation({
    summary: 'Удалить связь между задачами',
    description: 'Удаляет связь между задачами :taskId и :relatedTaskId.',
  })
  @ApiParam({ name: 'taskId', required: true, description: 'ID базовой задачи' })
  @ApiBody({
    type: UnlinkTaskDto,
    examples: {
      default: {
        value: { relatedTaskId: 23 },
      },
    },
  })
  @ApiResponse({ status: 204, description: 'Связь удалена' })
  @ApiResponse({ status: 404, description: 'Одна из задач не найдена' })
  async unlinkTasks(@Param('taskId') taskId: string, @Body() unlinkTaskDto: UnlinkTaskDto) {
    return this.tasksService.unlinkTasks(taskId, unlinkTaskDto.relatedTaskId);
  }
  @Get('filter-state')
  @ApiOperation({ summary: 'Получение состояния фильтров задач' })
  @ApiResponse({ status: 200, description: 'Фильтры успешно получены' })
  @UseGuards(AuthGuard)
  async getFilterState(@Req() req: RequestWithCookies) {
    return await this.tasksService.getUserFilterState(req.user.id);
  }
  @Delete(':taskId/comments')
  @ApiOperation({ summary: 'Удалить все комментарии у задачи' })
  @ApiParam({ name: 'taskId', type: String })
  async deleteAllComments(@Param('taskId') taskId: number) {
    return await this.tasksService.deleteAllForTask(taskId);
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Получение конкретной задачи' })
  @ApiResponse({
    status: 200,
    description: 'Задача успешно получена',
  })
  @UseGuards(AuthGuard, RolesGuard)
  async findTaskById(@Param() param: { taskId: number }, @Req() req: RequestWithCookies) {
    return await this.tasksService.findTaskById(param.taskId, req.user);
  }

  @Post()
  @ApiOperation({ summary: 'Создание задачи' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee)
  @ApiResponse({
    status: 200,
    description: 'Задача успешно создана',
    schema: CreateTaskResponseDto,
  })
  async createTask(@Body() createTaskDto: CreateTaskDto, @Req() req: RequestWithCookies) {
    return await this.tasksService.createTask(createTaskDto, req.user);
  }

  @Post(':taskId/duplicate')
  @ApiOperation({
    summary: 'Дублирование задачи',
    description:
      'Создаёт копию задачи :taskId со всеми настройками (проект, ответственный, участники, описание, дедлайн, story points, повторения и связанные задачи). Таймтреки и комментарии не копируются.',
  })
  @ApiParam({ name: 'taskId', description: 'ID задачи', type: String, example: '4', required: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee)
  @ApiResponse({
    status: 201,
    description: 'Задача успешно продублирована',
    schema: CreateTaskResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Задача не найдена' })
  async duplicateTask(@Param('taskId') taskId: string, @Req() req: RequestWithCookies) {
    return await this.tasksService.duplicateTask(Number(taskId), req.user);
  }

  @Post('parse-audio')
  @ApiOperation({
    summary: 'Анализ аудио и формирование структуры задачи без сохранения',
    description: `
Принимает аудиофайл, расшифровывает его, передаёт в AI
и возвращает JSON задачи (title, description, priority и т.д.)
без создания записи в базе данных.
  `,
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee)
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /audio\/(webm|ogg|mp4|mpeg|wav)/.test(file.mimetype);
        cb(null, ok);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Аудиофайл для анализа',
    required: true,
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Успешный разбор аудио. Возвращает JSON задачи без сохранения.',
    schema: {
      example: {
        transcript: 'Текст, который распознал Whisper',
        task: {
          title: 'Добавить форму обратной связи',
          description: 'На странице контактов добавить форму...',
          priority: 'high',
          dueDate: null,
          tags: ['frontend'],
        },
      },
    },
  })
  async parseAudio(@UploadedFile() file: Express.Multer.File) {
    this.logger.debug(
      {
        name: file?.originalname,
        mime: file?.mimetype,
        size: file?.size,
        hasBuffer: !!file?.buffer,
      },
      'Incoming audio(prod)',
    );
    return await this.tasksService.parseAudioToTask(file);
  }

  @Patch('filter-state')
  @ApiOperation({ summary: 'Сохранение состояния фильтров задач' })
  @ApiResponse({ status: 200, description: 'Фильтры успешно сохранены' })
  @UseGuards(AuthGuard)
  async saveFilterState(@Req() req: RequestWithCookies, @Body() filters: UpdateFilterStateDto) {
    return await this.tasksService.saveUserFilterState(req.user.id, filters);
  }

  @Patch('kanban-columns')
  @ApiOperation({ summary: 'Сохранение свёрнутых колонок Kanban' })
  @ApiResponse({ status: 200, description: 'Состояние колонок сохранено' })
  @UseGuards(AuthGuard)
  async saveKanbanColumns(@Req() req: RequestWithCookies, @Body() body: UpdateKanbanColumnsDto) {
    return await this.tasksService.saveUserCollapsedColumns(req.user.id, body.collapsed_columns);
  }

  @Patch('view-type')
  @ApiOperation({ summary: 'Сохранение выбранного режима отображения задач' })
  @ApiResponse({ status: 200, description: 'Режим отображения сохранён' })
  @UseGuards(AuthGuard)
  async saveViewType(@Req() req: RequestWithCookies, @Body() body: UpdateViewTypeDto) {
    return await this.tasksService.saveUserViewType(req.user.id, body.view_type);
  }

  @Patch(':taskId')
  @ApiOperation({ summary: 'Изменение задачи' })
  @ApiParam({
    name: 'taskId',
    description: 'ID задачи',
    type: String,
    example: '4',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Задача успешно изменена',
    schema: UpdateTaskResponseDto,
  })
  @UseGuards(AuthGuard, RolesGuard)
  async updateTask(@Param('taskId') taskId: string, @Body() updateTaskDto: UpdateTaskDto, @Req() req: RequestWithCookies) {
    return await this.tasksService.updateTask(taskId, updateTaskDto, req.user);
  }

  @Delete(':task_id')
  @ApiOperation({ summary: 'Удаление задачи' })
  @ApiParam({
    name: 'task_id',
    description: 'ID задачи',
    type: String,
    example: '4',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Задача успешно удалена',
  })
  @UseGuards(AuthGuard, RolesGuard)
  async deleteTask(@Param('task_id') task_id: number, @Req() req: RequestWithCookies) {
    return await this.tasksService.deleteTask(task_id, req.user);
  }

  @Post(':taskId/links')
  @ApiOperation({
    summary: 'Привязать существующую задачу',
    description: 'Создаёт связь между задачей :taskId и существующей задачей relatedTaskId (без создания новых задач).',
  })
  @ApiParam({ name: 'taskId', required: true, description: 'ID базовой задачи' })
  @ApiBody({
    type: LinkExistingDto,
    examples: {
      default: {
        value: { relatedTaskId: 'abc123', relation: 'relates_to' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Связь создана',
    schema: {
      example: {
        id: 'link_789',
        taskId: 'task_1',
        relatedTaskId: 'task_2',
        relation: 'relates_to',
        createdAt: '2025-12-13T02:10:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Нельзя привязать задачу к самой себе или некорректные данные' })
  @ApiResponse({ status: 404, description: 'Одна из задач не найдена' })
  async linkExistingTask(@Param('taskId') taskId: string, @Body() linkExistingDto: LinkExistingDto) {
    if (linkExistingDto.relatedTaskId === taskId) {
      throw new HttpException('Нельзя привязать задачу к самой себе', HttpStatus.BAD_REQUEST);
    }
    return this.tasksService.linkTasks(taskId, linkExistingDto.relatedTaskId);
  }

  @Post(':taskId/links/create')
  @ApiOperation({
    summary: 'Создать новую задачу и привязать к :taskId',
    description:
      'Создаёт новую задачу из переданных полей (title/description/...) и сразу связывает её с базовой задачей :taskId.',
  })
  @ApiParam({ name: 'taskId', required: true, description: 'ID базовой задачи' })
  @ApiBody({
    type: CreateAndLinkDto,
    examples: {
      default: {
        value: {
          title: 'Сверстать форму обратной связи',
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '...' }] }] },
          relation: 'parent',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Новая задача создана и привязана',
    schema: {
      example: {
        id: 'task_456',
        title: 'Сверстать форму обратной связи',
        // ...остальные поля
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Базовая задача :taskId не найдена' })
  async createAndLinkTask(@Param('taskId') taskId: string, @Body() createAndLinkDto: CreateAndLinkDto) {
    return this.tasksService.createAndLinkTask(taskId, createAndLinkDto);
  }
}
