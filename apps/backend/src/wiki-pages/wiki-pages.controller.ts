import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { WikiPagesService } from './wiki-pages.service';
import { CreateWikiPageDto } from './dto/create-wiki-page.dto';
import { UpdateWikiPageDto } from './dto/update-wiki-page.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WikiTreeNode } from './dto/tree-item.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequestWithCookies } from '../common/types/request';

@Controller('wiki-pages')
@ApiTags('Вики страницы')
@UseGuards(AuthGuard, RolesGuard)
export class WikiPagesController {
  constructor(private readonly wikiPagesService: WikiPagesService) {}

  @Post()
  @ApiOperation({ summary: 'Создать вики-страницу' })
  @ApiResponse({ status: 201, description: 'Вики-страница создана' })
  @ApiResponse({ status: 400, description: 'Некорректные данные страницы' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  create(@Body() createWikiPageDto: CreateWikiPageDto, @Req() req: RequestWithCookies) {
    return this.wikiPagesService.create(createWikiPageDto, req.user);
  }

  @Get('project/:project_id')
  @ApiOperation({ summary: 'Дерево вики-страниц проекта' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Дерево вики-страниц проекта',
    content: {
      'application/json': {
        schema: {
          example: [],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  findByFilter(@Param('project_id') project_id: number, @Req() req: RequestWithCookies): Promise<WikiTreeNode[]> {
    return this.wikiPagesService.findByFilter({ project_id }, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Вики-страница по ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Содержимое вики-страницы',
    content: {
      'application/json': {
        schema: {
          example: {
            id: 4,
            name: 'Название страницы',
            priority: '100',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      text: '',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
            created_at: '2025-07-23T10:00:41.310Z',
            updated_at: '2025-07-23T10:00:41.310Z',
            parent_page_id: null,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Вики-страница не найдена' })
  findOne(@Param('id') id: string, @Req() req: RequestWithCookies) {
    return this.wikiPagesService.findOne(+id, req.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить вики-страницу' })
  @ApiResponse({ status: 200, description: 'Вики-страница обновлена' })
  @ApiResponse({ status: 400, description: 'Некорректные данные страницы' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Вики-страница не найдена' })
  update(@Param('id') id: string, @Body() updateWikiPageDto: UpdateWikiPageDto, @Req() req: RequestWithCookies) {
    return this.wikiPagesService.update(+id, updateWikiPageDto, req.user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить вики-страницу' })
  @ApiResponse({ status: 200, description: 'Вики-страница удалена' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Вики-страница не найдена' })
  remove(@Param('id') id: string, @Req() req: RequestWithCookies) {
    return this.wikiPagesService.remove(+id, req.user);
  }
}
