import { BadRequestException, Body, Controller, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseTextDto } from './dto/parse-text.dto';
import { ParsedTaskDto } from './dto/parsed-task.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';

const MAX_TASK_SCREENSHOTS = 5;
const MAX_TASK_SCREENSHOT_SIZE = 5 * 1024 * 1024;
const MAX_TASK_SCREENSHOTS_TOTAL_SIZE = 15 * 1024 * 1024;
const TASK_SCREENSHOT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

@ApiTags('Deepseek')
@Controller('deepseek')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin, ROLES.employee)
export class DeepseekController {
  constructor(private readonly deepseekService: DeepseekService) {}

  @Post('parse-text-to-task')
  @ApiOperation({ summary: 'Парсинг текста и скриншотов в задачу с помощью GPT' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Исходный текст задачи' },
        instruction: { type: 'string', description: 'Дополнительная инструкция' },
        images: {
          type: 'array',
          maxItems: MAX_TASK_SCREENSHOTS,
          items: { type: 'string', format: 'binary' },
          description: 'Скриншоты PNG, JPEG или WebP, до 5 МБ каждый',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('images', MAX_TASK_SCREENSHOTS, {
      storage: memoryStorage(),
      limits: {
        files: MAX_TASK_SCREENSHOTS,
        fileSize: MAX_TASK_SCREENSHOT_SIZE,
      },
      fileFilter: (req, file, callback) => {
        if (!TASK_SCREENSHOT_MIME_TYPES.has(file.mimetype)) {
          callback(new BadRequestException('Поддерживаются скриншоты PNG, JPEG и WebP'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiResponse({
    status: 200,
    description: 'Задача успешно спарсена',
    type: ParsedTaskDto,
  })
  async parseTextToTask(@Body() body: ParseTextDto, @UploadedFiles() images: Express.Multer.File[] = []) {
    const text = body.text?.trim() ?? '';
    if (!text && images.length === 0) {
      throw new BadRequestException('Добавьте текст или хотя бы один скриншот');
    }

    const totalSize = images.reduce((sum, image) => sum + image.size, 0);
    if (totalSize > MAX_TASK_SCREENSHOTS_TOTAL_SIZE) {
      throw new BadRequestException('Общий размер скриншотов не должен превышать 15 МБ');
    }

    return this.deepseekService.parseTextToTaskGpt(
      text,
      body.instruction,
      images.map((image) => ({
        buffer: image.buffer,
        mimeType: image.mimetype,
      })),
    );
  }
}
