import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES } from '../common/enums/roles.enum';
import { RequestWithCookies } from '../common/types/request';
import { CreateMailAccountDto } from './dto/create-mail-account.dto';
import { CreateMailFolderDto } from './dto/create-mail-folder.dto';
import { FindThreadsDto } from './dto/find-threads.dto';
import { MailboxAccountQueryDto, MailboxOptionalAccountQueryDto } from './dto/mailbox-account-query.dto';
import { MailboxStatsDto } from './dto/mailbox-stats.dto';
import { MarkMailSpamDto } from './dto/mark-mail-spam.dto';
import { MoveMailThreadDto } from './dto/move-mail-thread.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { UpdateMailAccountDto } from './dto/update-mail-account.dto';
import { UpdateMailFolderDto } from './dto/update-mail-folder.dto';
import { MailDeliveryService } from './mail-delivery.service';
import { MailboxService } from './mailbox.service';

@Controller('mailbox')
@ApiTags('Почта')
@UseGuards(AuthGuard, RolesGuard)
export class MailboxController {
  constructor(
    private readonly mailboxService: MailboxService,
    private readonly mailDeliveryService: MailDeliveryService,
  ) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Список почтовых ящиков, доступных пользователю' })
  @ApiResponse({ status: 200, description: 'Список доступных ящиков' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  listAccounts(@Req() req: RequestWithCookies) {
    return this.mailboxService.listAccounts(req.user);
  }

  @Get('accounts/manage')
  @ApiOperation({ summary: 'Список всех почтовых ящиков (администрирование)' })
  @ApiResponse({ status: 200, description: 'Список всех ящиков' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  @Roles(ROLES.admin)
  listAllAccounts() {
    return this.mailboxService.listAllAccounts();
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Создать почтовый ящик' })
  @ApiResponse({ status: 201, description: 'Ящик создан' })
  @ApiResponse({ status: 400, description: 'Некорректные данные' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  @Roles(ROLES.admin)
  createAccount(@Body() dto: CreateMailAccountDto) {
    return this.mailboxService.createAccount(dto);
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Обновить настройки почтового ящика' })
  @ApiParam({ name: 'id', description: 'ID почтового ящика', type: Number })
  @ApiResponse({ status: 200, description: 'Ящик обновлён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав' })
  @ApiResponse({ status: 404, description: 'Ящик не найден' })
  @Roles(ROLES.admin)
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMailAccountDto) {
    return this.mailboxService.updateAccount(id, dto);
  }

  @Get('folders')
  @ApiOperation({ summary: 'Список пользовательских папок выбранного ящика' })
  listFolders(@Req() req: RequestWithCookies, @Query() dto: MailboxAccountQueryDto) {
    return this.mailboxService.listFolders(req.user, dto.account_id);
  }

  @Post('folders')
  @ApiOperation({ summary: 'Создать пользовательскую папку' })
  createFolder(@Req() req: RequestWithCookies, @Body() dto: CreateMailFolderDto) {
    return this.mailboxService.createFolder(req.user, dto);
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Переименовать пользовательскую папку' })
  updateFolder(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMailFolderDto) {
    return this.mailboxService.updateFolder(req.user, id, dto);
  }

  @Delete('folders/:id')
  @ApiOperation({ summary: 'Удалить пользовательскую папку и вернуть её переписки во Входящие' })
  async deleteFolder(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    await this.mailboxService.deleteFolder(req.user, id);
    return { success: true };
  }

  @Get('threads')
  @ApiOperation({ summary: 'Список цепочек писем с фильтрами и пагинацией' })
  @ApiResponse({ status: 200, description: 'Список цепочек писем' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  findThreads(@Req() req: RequestWithCookies, @Query() dto: FindThreadsDto) {
    return this.mailboxService.findThreads(req.user, dto);
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'Получить цепочку писем с сообщениями' })
  @ApiParam({ name: 'id', description: 'ID цепочки писем', type: Number })
  @ApiResponse({ status: 200, description: 'Цепочка писем с сообщениями' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Цепочка не найдена' })
  getThread(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    return this.mailboxService.getThreadWithMessages(req.user, id);
  }

  @Patch('threads/:id/read')
  @ApiOperation({ summary: 'Отметить цепочку писем как прочитанную' })
  @ApiParam({ name: 'id', description: 'ID цепочки писем', type: Number })
  @ApiResponse({ status: 200, description: 'Цепочка отмечена прочитанной' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Цепочка не найдена' })
  async markRead(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    await this.mailboxService.markThreadRead(req.user, id);

    return { success: true };
  }

  @Patch('threads/:id/task')
  @ApiOperation({ summary: 'Привязать цепочку писем к задаче или отвязать' })
  @ApiParam({ name: 'id', description: 'ID цепочки писем', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { task_id: { type: 'number', nullable: true, description: 'ID задачи или null для отвязки' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Привязка к задаче обновлена' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Цепочка не найдена' })
  linkTask(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number, @Body('task_id') taskId: number | null) {
    return this.mailboxService.linkThreadToTask(req.user, id, taskId ?? null);
  }

  @Patch('threads/:id/folder')
  @ApiOperation({ summary: 'Переместить цепочку писем в системную или пользовательскую папку' })
  @ApiParam({ name: 'id', description: 'ID цепочки писем', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        system_folder: { type: 'string', enum: ['inbox', 'spam', 'trash'], description: 'Системная папка' },
        custom_folder_id: { type: 'number', description: 'ID пользовательской папки' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Цепочка перемещена' })
  @ApiResponse({ status: 400, description: 'Недопустимая папка' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Цепочка не найдена' })
  moveToFolder(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number, @Body() dto: MoveMailThreadDto) {
    return this.mailboxService.moveThreadToFolder(req.user, id, dto);
  }

  @Post('threads/:id/spam')
  @ApiOperation({ summary: 'Пометить отправителя или его домен как спам' })
  markSpam(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number, @Body() dto: MarkMailSpamDto) {
    return this.mailboxService.markThreadAsSpam(req.user, id, dto);
  }

  @Post('threads/:id/not-spam')
  @ApiOperation({ summary: 'Убрать переписку из спама и удалить подходящие пользовательские правила' })
  markNotSpam(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    return this.mailboxService.markThreadAsNotSpam(req.user, id);
  }

  @Post('messages/:id/retry')
  @ApiOperation({ summary: 'Повторить отправку недоставленного письма' })
  retryMessage(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    return this.mailboxService.retryMessage(req.user, id);
  }

  @Delete('threads/:id')
  @ApiOperation({ summary: 'Удалить цепочку писем безвозвратно' })
  @ApiParam({ name: 'id', description: 'ID цепочки писем', type: Number })
  @ApiResponse({ status: 200, description: 'Цепочка удалена' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Цепочка не найдена' })
  async deleteThread(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    await this.mailboxService.deleteThreadPermanently(req.user, id);

    return { success: true };
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Удалить письмо из цепочки' })
  @ApiParam({ name: 'id', description: 'ID письма', type: Number })
  @ApiResponse({ status: 200, description: 'Письмо удалено' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Письмо не найдено' })
  async deleteMessage(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    await this.mailboxService.softDeleteMessage(req.user, id);

    return { success: true };
  }

  @Post('drafts')
  @ApiOperation({ summary: 'Сохранить черновик письма (создать или обновить)' })
  @ApiResponse({ status: 201, description: 'Черновик сохранён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  saveDraft(@Req() req: RequestWithCookies, @Body() dto: SaveDraftDto) {
    return this.mailboxService.saveDraft(req.user, dto);
  }

  @Post('drafts/:id/send')
  @ApiOperation({ summary: 'Отправить ранее сохранённый черновик' })
  @ApiParam({ name: 'id', description: 'ID черновика', type: Number })
  @ApiResponse({ status: 201, description: 'Черновик отправлен' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Черновик не найден' })
  sendDraft(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number) {
    return this.mailboxService.sendDraft(req.user, id);
  }

  @Post('attachments')
  @ApiOperation({ summary: 'Загрузить вложение для исходящего письма' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary', description: 'Файл вложения' } } },
  })
  @ApiResponse({ status: 201, description: 'Вложение загружено' })
  @ApiResponse({ status: 400, description: 'Файл не передан' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    return this.mailboxService.uploadOutboundAttachment(file);
  }

  @Post('send')
  @ApiOperation({ summary: 'Отправить письмо' })
  @ApiResponse({ status: 201, description: 'Письмо отправлено' })
  @ApiResponse({ status: 400, description: 'Некорректные данные' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  sendMail(@Req() req: RequestWithCookies, @Body() dto: SendMailDto) {
    return this.mailboxService.sendMail(req.user, dto);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Количество непрочитанных писем по папкам' })
  @ApiResponse({
    status: 200,
    description: 'Непрочитанные во входящих (`count`/`inbox`), спаме (`spam`) и корзине (`trash`)',
  })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  getUnreadCount(@Req() req: RequestWithCookies, @Query() dto: MailboxOptionalAccountQueryDto) {
    return this.mailboxService.getUnreadCounts(req.user, dto.account_id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Статистика доставки исходящих писем по доступным ящикам' })
  @ApiResponse({ status: 200, description: 'Сводка отправок, открытий, bounce и жалоб' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  getStats(@Req() req: RequestWithCookies, @Query() dto: MailboxStatsDto) {
    return this.mailDeliveryService.getStats(req.user, {
      accountId: dto.account_id,
      from: dto.from,
      to: dto.to,
    });
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Список контактов из переписки' })
  @ApiResponse({ status: 200, description: 'Список контактов' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  async getContacts(@Req() req: RequestWithCookies) {
    return { contacts: await this.mailboxService.getContacts(req.user) };
  }

  @Get('attachments/:id')
  @ApiOperation({ summary: 'Скачать вложение письма' })
  @ApiParam({ name: 'id', description: 'ID вложения', type: Number })
  @ApiResponse({ status: 200, description: 'Содержимое файла вложения' })
  @ApiResponse({ status: 401, description: 'Не авторизован' })
  @ApiResponse({ status: 404, description: 'Вложение не найдено' })
  async downloadAttachment(@Req() req: RequestWithCookies, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { attachment, stream } = await this.mailboxService.getAttachmentForUser(req.user, id);

    res.setHeader('Content-Type', attachment.content_type);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);

    stream.body.pipe(res);
  }
}
