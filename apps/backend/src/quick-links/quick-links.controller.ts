import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { QuickLinksService } from './quick-links.service';
import { CreateQuickLinkDto } from './dto/create-quick-link.dto';
import { UpdateQuickLinkDto } from './dto/update-quick-link.dto';
import { QuickLinkResponseDto } from './dto/quick-link-response.dto';
import { AuthGuard } from '../auth/guards/auth.guard';

@ApiTags('Быстрые ссылки')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('quick-links')
export class QuickLinksController {
  constructor(private readonly quickLinksService: QuickLinksService) {}

  @Get()
  @ApiOperation({ summary: 'Получить все быстрые ссылки пользователя для проекта' })
  @ApiQuery({ name: 'project_id', required: true, type: Number })
  @ApiOkResponse({ type: [QuickLinkResponseDto], description: 'Список быстрых ссылок пользователя в проекте' })
  @ApiResponse({ status: 400, description: 'Не передан обязательный параметр project_id' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  async findAll(
    @Request() req: Request & { user: { id: number } },
    @Query('project_id') projectId: string,
  ): Promise<QuickLinkResponseDto[]> {
    if (!projectId) {
      throw new BadRequestException('project_id is required');
    }
    return this.quickLinksService.findByUser(req.user.id, +projectId);
  }

  @Post()
  @ApiOperation({ summary: 'Создать быструю ссылку' })
  @ApiOkResponse({ type: QuickLinkResponseDto, description: 'Созданная быстрая ссылка' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  async create(
    @Request() req: Request & { user: { id: number } },
    @Body() createQuickLinkDto: CreateQuickLinkDto,
  ): Promise<QuickLinkResponseDto> {
    return this.quickLinksService.create(req.user.id, createQuickLinkDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить быструю ссылку' })
  @ApiOkResponse({ type: QuickLinkResponseDto, description: 'Обновлённая быстрая ссылка' })
  @ApiResponse({ status: 400, description: 'Некорректные данные запроса' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Быстрая ссылка не найдена' })
  async update(
    @Request() req: Request & { user: { id: number } },
    @Param('id') id: string,
    @Body() updateQuickLinkDto: UpdateQuickLinkDto,
  ): Promise<QuickLinkResponseDto> {
    return this.quickLinksService.update(+id, req.user.id, updateQuickLinkDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить быструю ссылку' })
  @ApiOkResponse({ description: 'Быстрая ссылка удалена' })
  @ApiResponse({ status: 401, description: 'Пользователь не авторизован' })
  @ApiResponse({ status: 404, description: 'Быстрая ссылка не найдена' })
  async delete(@Request() req: Request & { user: { id: number } }, @Param('id') id: string): Promise<void> {
    return this.quickLinksService.delete(+id, req.user.id);
  }
}
