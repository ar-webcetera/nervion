import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { GitService } from './git.service';
import { CreateRepoDto } from './dto/create-repo.dto';

@ApiTags('Git')
@Controller('git')
@UseGuards(AuthGuard)
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Get('repos')
  @ApiOperation({ summary: 'Список репозиториев (опционально по проекту)' })
  @ApiResponse({ status: 200, description: 'Список репозиториев' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  repos(@Query('projectId') projectId?: string) {
    return this.gitService.listRepos(projectId ? Number(projectId) : undefined);
  }

  @Get('initial')
  @ApiOperation({ summary: 'Первичные данные раздела (репы + ветки/коммиты/дерево + деталь по URL)' })
  @ApiResponse({ status: 200, description: 'Первичные данные раздела Git' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Репозиторий не найден' })
  initial(
    @Query('projectId') projectId?: string,
    @Query('repo') repo?: string,
    @Query('branch') branch?: string,
    @Query('commit') commit?: string,
    @Query('file') file?: string,
  ) {
    return this.gitService.getInitial(
      projectId ? Number(projectId) : undefined,
      repo ? Number(repo) : undefined,
      branch || undefined,
      commit || undefined,
      file || undefined,
    );
  }

  @Post('repos')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Подключить репозиторий' })
  @ApiResponse({ status: 201, description: 'Репозиторий подключён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные репозитория' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  createRepo(@Body() dto: CreateRepoDto) {
    return this.gitService.createRepo(dto);
  }

  @Delete('repos/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отключить репозиторий' })
  @ApiResponse({ status: 204, description: 'Репозиторий отключён' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав (нужен admin)' })
  @ApiResponse({ status: 404, description: 'Репозиторий не найден' })
  deleteRepo(@Param('id') id: string) {
    return this.gitService.deleteRepo(Number(id));
  }

  @Get(':repoId/branches')
  @ApiOperation({ summary: 'Ветки репозитория' })
  @ApiResponse({ status: 200, description: 'Список веток репозитория' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Репозиторий не найден' })
  branches(@Param('repoId') repoId: string) {
    return this.gitService.branches(Number(repoId));
  }

  @Get(':repoId/commits')
  @ApiOperation({ summary: 'Коммиты ветки (постранично)' })
  @ApiResponse({ status: 200, description: 'Список коммитов ветки' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Репозиторий или ветка не найдены' })
  commits(
    @Param('repoId') repoId: string,
    @Query('branch') branch?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.gitService.commits(Number(repoId), branch, page ? Number(page) : 1, perPage ? Number(perPage) : 30);
  }

  @Get(':repoId/tree')
  @ApiOperation({ summary: 'Содержимое каталога в ветке/коммите' })
  @ApiResponse({ status: 200, description: 'Содержимое каталога' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Репозиторий или путь не найдены' })
  tree(@Param('repoId') repoId: string, @Query('ref') ref?: string, @Query('path') path?: string) {
    return this.gitService.tree(Number(repoId), ref, path ?? '');
  }

  @Get(':repoId/file')
  @ApiOperation({ summary: 'Содержимое файла' })
  @ApiResponse({ status: 200, description: 'Содержимое файла' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Файл не найден' })
  file(@Param('repoId') repoId: string, @Query('ref') ref: string, @Query('path') path: string) {
    return this.gitService.file(Number(repoId), ref, path);
  }

  @Get(':repoId/raw')
  @ApiOperation({ summary: 'Сырой блоб (картинка) с MIME-типом' })
  @ApiResponse({ status: 200, description: 'Бинарное содержимое блоба' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Блоб не найден' })
  async raw(@Param('repoId') repoId: string, @Query('ref') ref: string, @Query('path') path: string, @Res() res: Response) {
    const { buffer, contentType } = await this.gitService.rawBlob(Number(repoId), ref, path);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }

  @Get(':repoId/diff')
  @ApiOperation({ summary: 'Дифф коммита (commit) или веток (base+head)' })
  @ApiResponse({ status: 200, description: 'Дифф коммита или диапазона веток' })
  @ApiResponse({ status: 400, description: 'Не указан commit или пара base+head' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Репозиторий не найден' })
  diff(
    @Param('repoId') repoId: string,
    @Query('commit') commit?: string,
    @Query('base') base?: string,
    @Query('head') head?: string,
  ) {
    if (commit) return this.gitService.diffCommit(Number(repoId), commit);
    if (base && head) return this.gitService.diffRange(Number(repoId), base, head);
    throw new BadRequestException('Укажите commit или base+head');
  }
}
