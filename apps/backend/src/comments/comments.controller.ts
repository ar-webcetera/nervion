import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FindCommentsByFilterDto } from './dto/find-comments-by-filter.dto';

@Controller('comments')
@ApiTags('Комментарии')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @ApiOperation({ summary: 'Создать комментарий' })
  @ApiResponse({ status: 201, description: 'Комментарий создан' })
  @ApiResponse({ status: 400, description: 'Некорректные данные комментария' })
  @Post()
  create(@Body() createCommentDto: CreateCommentDto) {
    return this.commentsService.create(createCommentDto);
  }

  @ApiOperation({ summary: 'Получить список комментариев по фильтру' })
  @ApiResponse({ status: 200, description: 'Список комментариев' })
  @Get()
  findByFilter(@Query() findCommentsByFilterDto: FindCommentsByFilterDto) {
    return this.commentsService.findCommentsByFilter(findCommentsByFilterDto);
  }

  @ApiOperation({ summary: 'Получить комментарий по идентификатору' })
  @ApiResponse({ status: 200, description: 'Найденный комментарий' })
  @ApiResponse({ status: 404, description: 'Комментарий не найден' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.commentsService.findOne(+id);
  }

  @ApiOperation({ summary: 'Обновить комментарий' })
  @ApiResponse({ status: 200, description: 'Комментарий обновлён' })
  @ApiResponse({ status: 404, description: 'Комментарий не найден' })
  @Patch(':id')
  update(@Param('id') id: number, @Body() updateCommentDto: UpdateCommentDto) {
    return this.commentsService.update(+id, updateCommentDto);
  }

  @ApiOperation({ summary: 'Удалить комментарий' })
  @ApiResponse({ status: 200, description: 'Комментарий удалён' })
  @ApiResponse({ status: 404, description: 'Комментарий не найден' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.commentsService.remove(+id);
  }
}
