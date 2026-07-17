import {
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FilesService } from './files.service';
import { UnloadFileDto } from './dto/unload-file.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { GetFilesDto } from './dto/get-files.dto';
import { GetFilesResponseDto } from './dto/get-files-response.dto';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

const FALLBACK_DOWNLOAD_FILE_NAME = 'file';

const requireKey = (key: string | undefined): string => {
  const normalized = typeof key === 'string' ? key.trim() : '';
  if (!normalized) {
    throw new BadRequestException('Query parameter "key" is required');
  }
  return normalized;
};

const decodeKey = (key: string) => {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

const extractFileNameFromKey = (key: string) => {
  const normalizedKey = decodeKey(key);
  const fileName = normalizedKey.split('/').filter(Boolean).at(-1)?.trim();

  return fileName || FALLBACK_DOWNLOAD_FILE_NAME;
};

const toAsciiFilename = (value: string) => {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim();

  return normalized || FALLBACK_DOWNLOAD_FILE_NAME;
};

const encodeForContentDisposition = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

@Controller('files')
@ApiTags('Файлы')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Загрузка файла в хранилище' })
  @ApiBody({
    description: 'Загрузка файла',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Файл для загрузки',
        },
        prefix: {
          type: 'string',
          example: 'task-files/123/',
          description: 'Префикс для загрузки файла',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Файл успешно загружен' })
  @ApiResponse({ status: 400, description: 'Файл не передан или некорректный префикс' })
  unloadFile(@UploadedFile() file: Express.Multer.File, @Body() unloadFileDto: UnloadFileDto) {
    return this.filesService.unloadFile(file, unloadFileDto);
  }

  @Post('folder')
  @ApiOperation({ summary: 'Создание папки в хранилище' })
  @ApiOkResponse({ description: 'Папка успешно создана' })
  @ApiResponse({ status: 400, description: 'Некорректные данные папки' })
  createFolder(@Body() createFolderDto: CreateFolderDto) {
    return this.filesService.createFolder(createFolderDto);
  }

  @Get('content')
  @ApiOperation({ summary: 'Получение содержимого файла из хранилища' })
  @ApiOkResponse({ description: 'Текстовое содержимое файла' })
  @ApiResponse({ status: 400, description: 'Не передан параметр key' })
  @ApiResponse({ status: 404, description: 'Файл не найден' })
  async getFileContent(@Query('key') key: string, @Res() res: Response) {
    const safeKey = requireKey(key);
    const content = await this.filesService.getFileContent(safeKey);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8').send(content);
  }

  @Get('raw')
  @ApiOperation({ summary: 'Получение бинарного файла из хранилища' })
  @ApiOkResponse({ description: 'Бинарное содержимое файла' })
  @ApiResponse({ status: 400, description: 'Не передан параметр key' })
  @ApiResponse({ status: 404, description: 'Файл не найден' })
  async getRawFile(@Query('key') key: string, @Res() res: Response) {
    const safeKey = requireKey(key);
    const file = await this.filesService.getRawFile(safeKey);
    const fileName = extractFileNameFromKey(safeKey);

    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${toAsciiFilename(fileName)}"; filename*=UTF-8''${encodeForContentDisposition(fileName)}`,
    );

    if (file.contentLength !== undefined) {
      res.setHeader('Content-Length', String(file.contentLength));
    }

    if (file.etag) {
      res.setHeader('ETag', file.etag);
    }

    if (file.lastModified) {
      res.setHeader('Last-Modified', file.lastModified.toUTCString());
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(file.body));
  }

  @Put('content')
  @ApiOperation({ summary: 'Сохранение содержимого файла в хранилище' })
  @ApiOkResponse({ description: 'Файл успешно сохранён' })
  @ApiResponse({ status: 400, description: 'Не передан параметр key' })
  async putFileContent(@Query('key') key: string, @Body('content') content: string) {
    await this.filesService.putFileContent(key, content);
    return { ok: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Удаление файла из хранилища' })
  @ApiOkResponse({ description: 'Файл успешно удалён' })
  @ApiResponse({ status: 400, description: 'Не передан параметр key' })
  async deleteFile(@Query('key') key: string): Promise<{ ok: boolean }> {
    await this.filesService.deleteFile(key);
    return { ok: true };
  }

  @Delete('folder')
  @ApiOperation({ summary: 'Удаление папки из хранилища' })
  @ApiOkResponse({ description: 'Папка успешно удалена' })
  @ApiResponse({ status: 400, description: 'Не передан префикс папки' })
  async deleteFolder(@Query('prefix') prefix: string): Promise<{ ok: boolean }> {
    await this.filesService.deleteFolder(prefix);
    return { ok: true };
  }

  @Get()
  @ApiOperation({ summary: 'Получение файлов из хранилища' })
  @ApiResponse({
    status: 200,
    description: 'Файлы успешно получены',
    schema: GetFilesResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Неверные параметры запроса',
  })
  async getFiles(@Query() query: GetFilesDto) {
    return this.filesService.getFiles(query);
  }
}
