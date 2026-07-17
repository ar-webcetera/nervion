import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PushService } from '../push/push.service';
import { StorageService } from '../storage/storage.service';
import { CreateMailAccountDto } from './dto/create-mail-account.dto';
import { FindThreadsDto, MAIL_FOLDER_FILTER } from './dto/find-threads.dto';
import { MailAttachmentInputDto } from './dto/mail-attachment-input.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { UpdateMailAccountDto } from './dto/update-mail-account.dto';
import { MailAccounts, MAIL_ACCOUNT_TYPES } from './entities/mail-account.entity';
import { MailAttachments } from './entities/mail-attachment.entity';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailThreads, MAIL_FOLDERS } from './entities/mail-thread.entity';
import { Users } from '../users/entities/users.entity';
import { InboundMailData } from './mailbox.types';
import { buildReferencesHeader, canAccessAccount, extractReferencedIds, parseTaskIdFromAddress } from './mailbox.utils';
import { PostboxService } from './postbox.service';

const DEFAULT_THREADS_LIMIT = 30;
const MAX_THREADS_LIMIT = 100;

@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);

  constructor(
    @InjectRepository(MailAccounts)
    private readonly accountsRepository: Repository<MailAccounts>,
    @InjectRepository(MailThreads)
    private readonly threadsRepository: Repository<MailThreads>,
    @InjectRepository(MailMessages)
    private readonly messagesRepository: Repository<MailMessages>,
    @InjectRepository(MailAttachments)
    private readonly attachmentsRepository: Repository<MailAttachments>,
    private readonly storageService: StorageService,
    private readonly postboxService: PostboxService,
    private readonly configService: ConfigService,
    private readonly pushService: PushService,
  ) {}

  async findAccountByAddress(address: string): Promise<MailAccounts | null> {
    return this.accountsRepository.findOne({ where: { address: address.toLowerCase(), is_active: true } });
  }

  async findOrCreateInboundAccount(address: string): Promise<MailAccounts> {
    const normalized = address.toLowerCase();
    const existing = await this.accountsRepository.findOne({ where: { address: normalized } });

    if (existing) {
      return existing;
    }

    return this.accountsRepository.save(
      this.accountsRepository.create({
        address: normalized,
        display_name: null,
        type: MAIL_ACCOUNT_TYPES.service,
        user_id: null,
        is_active: true,
        signature_html: null,
      }),
    );
  }

  async findTaskAliasAccount(): Promise<MailAccounts | null> {
    const configured = this.configService.get<string>('MAILBOX_TASK_ALIAS_ACCOUNT');

    if (configured) {
      const account = await this.findAccountByAddress(configured);
      if (account) {
        return account;
      }
    }

    return this.accountsRepository.findOne({
      where: { type: MAIL_ACCOUNT_TYPES.service, is_active: true },
      order: { id: 'ASC' },
    });
  }

  async listAccounts(user: AuthenticatedUser): Promise<MailAccounts[]> {
    const accounts = await this.accountsRepository.find({
      order: { id: 'ASC' },
      relations: { allowedUsers: true },
    });

    return accounts.filter((account) => canAccessAccount(user, account));
  }

  async listAllAccounts(): Promise<MailAccounts[]> {
    return this.accountsRepository.find({
      order: { id: 'ASC' },
      relations: { allowedUsers: true },
    });
  }

  async createAccount(dto: CreateMailAccountDto): Promise<MailAccounts> {
    const address = dto.address.toLowerCase();
    const existing = await this.accountsRepository.findOne({ where: { address } });

    if (existing) {
      throw new BadRequestException(`Ящик ${address} уже существует`);
    }

    const account = this.accountsRepository.create({
      address,
      display_name: dto.display_name ?? null,
      type: dto.type ?? MAIL_ACCOUNT_TYPES.service,
      user_id: dto.user_id ?? null,
      signature_html: dto.signature_html ?? null,
      is_active: dto.is_active ?? true,
      allowedUsers: (dto.allowedUserIds ?? []).map((id) => ({ id }) as Users),
    });

    return this.accountsRepository.save(account);
  }

  async updateAccount(id: number, dto: UpdateMailAccountDto): Promise<MailAccounts> {
    const account = await this.accountsRepository.findOne({
      where: { id },
      relations: { allowedUsers: true },
    });

    if (!account) {
      throw new NotFoundException('Ящик не найден');
    }

    if (dto.address) {
      account.address = dto.address.toLowerCase();
    }
    if (dto.display_name !== undefined) {
      account.display_name = dto.display_name ?? null;
    }
    if (dto.type !== undefined) {
      account.type = dto.type;
    }
    if (dto.user_id !== undefined) {
      account.user_id = dto.user_id ?? null;
    }
    if (dto.signature_html !== undefined) {
      account.signature_html = dto.signature_html ?? null;
    }
    if (dto.is_active !== undefined) {
      account.is_active = dto.is_active;
    }
    if (dto.allowedUserIds !== undefined) {
      account.allowedUsers = dto.allowedUserIds.map((uid) => ({ id: uid }) as Users);
    }

    return this.accountsRepository.save(account);
  }

  private async getAccountForUser(user: AuthenticatedUser, accountId: number): Promise<MailAccounts> {
    const account = await this.accountsRepository.findOne({
      where: { id: accountId },
      relations: { allowedUsers: true },
    });

    if (!account) {
      throw new NotFoundException('Ящик не найден');
    }

    if (!canAccessAccount(user, account)) {
      throw new ForbiddenException('Нет доступа к этому ящику');
    }

    return account;
  }

  async ingestInbound(account: MailAccounts, data: InboundMailData): Promise<MailMessages | null> {
    if (data.messageId) {
      const duplicate = await this.messagesRepository
        .createQueryBuilder('message')
        .innerJoin('message.thread', 'thread')
        .where('message.message_id = :messageId', { messageId: data.messageId })
        .andWhere('thread.account_id = :accountId', { accountId: account.id })
        .getOne();

      if (duplicate) {
        this.logger.warn(`Дубль письма ${data.messageId} для ${account.address} — пропущен`);
        return null;
      }
    }

    const thread = await this.resolveInboundThread(account, data);

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        thread_id: thread.id,
        direction: MAIL_DIRECTIONS.inbound,
        message_id: data.messageId,
        in_reply_to: data.inReplyTo,
        references_header: data.referencesHeader,
        from_address: data.from.address,
        from_name: data.from.name ?? null,
        to_addresses: data.to,
        cc_addresses: data.cc,
        subject: data.subject,
        text_body: data.text,
        html_body: data.html,
        raw_s3_key: data.rawS3Key,
        auth_results: data.authResults,
        status: MAIL_MESSAGE_STATUSES.received,
      }),
    );

    await this.saveAttachments(account, thread, message, data);

    thread.last_message_at = new Date();
    if (!thread.counterparty_address) {
      thread.counterparty_address = data.from.address;
    }
    await this.threadsRepository.save(thread);

    await this.notifyInboundMessage(account.id, thread.id, message.id, data);

    return message;
  }

  private async notifyInboundMessage(
    accountId: number,
    threadId: number,
    messageId: number,
    data: InboundMailData,
  ): Promise<void> {
    try {
      const account = await this.accountsRepository.findOne({
        where: { id: accountId },
        relations: { allowedUsers: true },
      });
      const recipientIds = [...new Set((account?.allowedUsers ?? []).map((user) => user.id))];
      if (recipientIds.length === 0) return;

      const sender = data.from.name?.trim() || data.from.address;
      const subject = data.subject?.trim() || '(без темы)';
      const preview = (data.text ?? '').replace(/\s+/g, ' ').trim();
      const body = preview ? `${subject}: ${preview.slice(0, 180)}` : subject;

      await this.pushService.sendToUsers(recipientIds, {
        title: `Новое письмо от ${sender}`,
        body,
        url: `/mail?folder=inbox&account=${accountId}&thread=${threadId}`,
        tag: `mail-message-${messageId}`,
      });
    } catch (error) {
      this.logger.warn(`Не удалось отправить push о письме ${messageId}: ${String(error)}`);
    }
  }

  private async resolveInboundThread(account: MailAccounts, data: InboundMailData): Promise<MailThreads> {
    const referencedIds = extractReferencedIds(data.inReplyTo, data.referencesHeader);

    if (referencedIds.length > 0) {
      const referenced = await this.messagesRepository
        .createQueryBuilder('message')
        .innerJoinAndSelect('message.thread', 'thread')
        .where('message.message_id IN (:...ids)', { ids: referencedIds })
        .andWhere('thread.account_id = :accountId', { accountId: account.id })
        .orderBy('message.id', 'DESC')
        .getOne();

      if (referenced) {
        return referenced.thread;
      }
    }

    const taskId = data.to
      .concat(data.cc)
      .map((recipient) => parseTaskIdFromAddress(recipient.address))
      .find((id) => id !== null);

    return this.threadsRepository.save(
      this.threadsRepository.create({
        subject: data.subject || '(без темы)',
        account_id: account.id,
        task_id: taskId ?? null,
        counterparty_address: data.from.address,
        last_message_at: new Date(),
      }),
    );
  }

  private async saveAttachments(
    account: MailAccounts,
    thread: MailThreads,
    message: MailMessages,
    data: InboundMailData,
  ): Promise<void> {
    for (const attachment of data.attachments) {
      const safeName = (attachment.filename || 'attachment').replace(/[^\wа-яА-ЯёЁ.-]+/g, '_').slice(0, 200);
      const key = `mailbox/${account.id}/${thread.id}/${randomUUID()}-${safeName}`;

      await this.storageService.uploadObject(key, attachment.content, attachment.contentType || 'application/octet-stream');

      await this.attachmentsRepository.save(
        this.attachmentsRepository.create({
          message_id: message.id,
          filename: attachment.filename || safeName,
          content_type: attachment.contentType || 'application/octet-stream',
          size: attachment.size,
          s3_key: key,
          content_id: attachment.contentId ?? null,
          is_inline: attachment.isInline ?? false,
        }),
      );
    }
  }

  async getContacts(user: AuthenticatedUser): Promise<string[]> {
    const access = `AND a.id IN (SELECT mail_account_id FROM mail_account_access WHERE user_id = $1)`;
    const params = [user.id];

    const sql = `
      SELECT DISTINCT addr FROM (
        SELECT lower(m.from_address) AS addr
          FROM mail_messages m
          JOIN mail_threads t ON t.id = m.thread_id
          JOIN mail_accounts a ON a.id = t.account_id
         WHERE m.direction = 'inbound' AND m.from_address IS NOT NULL ${access}
        UNION
        SELECT lower(elem->>'address') AS addr
          FROM mail_messages m
          JOIN mail_threads t ON t.id = m.thread_id
          JOIN mail_accounts a ON a.id = t.account_id
          CROSS JOIN LATERAL jsonb_array_elements(m.to_addresses) AS elem
         WHERE m.direction = 'outbound' ${access}
      ) s
      WHERE addr IS NOT NULL AND addr <> ''
      ORDER BY addr
      LIMIT 1000
    `;

    const rows = await this.messagesRepository.query(sql, params);
    return (rows as { addr: string }[]).map((row) => row.addr);
  }

  async uploadOutboundAttachment(file: Express.Multer.File): Promise<MailAttachmentInputDto> {
    const original = file.originalname || 'file';
    const safeName = original.replace(/[^\wа-яА-ЯёЁ.-]+/g, '_').slice(0, 200);
    const key = `mailbox/outbound/${randomUUID()}-${safeName}`;
    const contentType = file.mimetype || 'application/octet-stream';

    await this.storageService.uploadObject(key, file.buffer, contentType);

    return { s3_key: key, filename: original, content_type: contentType, size: file.size };
  }

  private async buildPostboxAttachments(
    items: { s3_key: string; filename: string; content_type: string }[],
  ): Promise<{ filename: string; content: Readable; contentType: string }[]> {
    const result: { filename: string; content: Readable; contentType: string }[] = [];
    for (const item of items) {
      const stream = await this.storageService.getObjectStream(item.s3_key);
      result.push({ filename: item.filename, content: stream.body, contentType: item.content_type });
    }
    return result;
  }

  private async syncOutboundAttachments(messageId: number, items?: MailAttachmentInputDto[]): Promise<void> {
    await this.attachmentsRepository.delete({ message_id: messageId });
    if (!items?.length) {
      return;
    }
    await this.attachmentsRepository.save(
      items.map((item) =>
        this.attachmentsRepository.create({
          message_id: messageId,
          filename: item.filename,
          content_type: item.content_type,
          size: item.size,
          s3_key: item.s3_key,
          content_id: null,
          is_inline: false,
        }),
      ),
    );
  }

  async sendMail(user: AuthenticatedUser, dto: SendMailDto): Promise<MailMessages> {
    const account = await this.getAccountForUser(user, dto.account_id);

    let thread: MailThreads | null = null;
    let inReplyTo: string | null = null;
    let references: string | null = null;

    if (dto.thread_id) {
      thread = await this.threadsRepository.findOne({ where: { id: dto.thread_id } });

      if (!thread || thread.account_id !== account.id) {
        throw new NotFoundException('Тред не найден');
      }

      const lastMessage = await this.messagesRepository.findOne({
        where: { thread_id: thread.id },
        order: { id: 'DESC' },
      });

      if (lastMessage) {
        inReplyTo = lastMessage.message_id;
        references = buildReferencesHeader(lastMessage.references_header, lastMessage.message_id);
      }
    }

    let sentMessageId: string;

    try {
      sentMessageId = await this.postboxService.send({
        from: { address: account.address, name: account.display_name },
        to: dto.to,
        cc: dto.cc,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
        inReplyTo,
        references,
        attachments: dto.attachments?.length ? await this.buildPostboxAttachments(dto.attachments) : undefined,
      });
    } catch (error) {
      this.logger.error(`Ошибка отправки письма с ${account.address}: ${error}`);

      if (error instanceof Error && error.name === 'ServiceUnavailableException') {
        throw error;
      }

      throw new InternalServerErrorException('Не удалось отправить письмо');
    }

    if (!thread) {
      thread = await this.threadsRepository.save(
        this.threadsRepository.create({
          subject: dto.subject || '(без темы)',
          account_id: account.id,
          task_id: dto.task_id ?? null,
          counterparty_address: dto.to[0],
          last_message_at: new Date(),
        }),
      );
    } else {
      thread.last_message_at = new Date();
      await this.threadsRepository.save(thread);
    }

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        thread_id: thread.id,
        direction: MAIL_DIRECTIONS.outbound,
        message_id: sentMessageId,
        in_reply_to: inReplyTo,
        references_header: references,
        from_address: account.address,
        from_name: account.display_name,
        to_addresses: dto.to.map((address) => ({ address })),
        cc_addresses: (dto.cc ?? []).map((address) => ({ address })),
        subject: dto.subject,
        text_body: dto.text ?? null,
        html_body: dto.html ?? null,
        auth_results: null,
        is_read: true,
        status: MAIL_MESSAGE_STATUSES.sent,
        sent_by_user_id: user.id,
      }),
    );

    await this.syncOutboundAttachments(message.id, dto.attachments);

    return message;
  }

  async findThreads(user: AuthenticatedUser, dto: FindThreadsDto) {
    const limit = Math.min(dto.limit ?? DEFAULT_THREADS_LIMIT, MAX_THREADS_LIMIT);
    const page = dto.page ?? 1;

    const query = this.threadsRepository
      .createQueryBuilder('thread')
      .innerJoinAndSelect('thread.account', 'account')
      .loadRelationCountAndMap('thread.unread_count', 'thread.messages', 'unread', (qb) =>
        qb.where('unread.is_read = false AND unread.direction = :inbound', { inbound: MAIL_DIRECTIONS.inbound }),
      )
      .orderBy('thread.last_message_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    query.andWhere('account.id IN (SELECT mail_account_id FROM mail_account_access WHERE user_id = :userId)', {
      userId: user.id,
    });

    const folder = dto.folder ?? MAIL_FOLDER_FILTER.inbox;
    if (folder === MAIL_FOLDER_FILTER.trash) {
      query.andWhere('thread.folder = :trashFolder', { trashFolder: MAIL_FOLDERS.trash });
    } else {
      query.andWhere('thread.folder = :inboxFolder', { inboxFolder: MAIL_FOLDERS.inbox });

      if (folder === MAIL_FOLDER_FILTER.inbox) {
        query.andWhere(
          `EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = thread.id
             AND m.direction = :inbDir AND m.deleted_at IS NULL)`,
          { inbDir: MAIL_DIRECTIONS.inbound },
        );
      } else if (folder === MAIL_FOLDER_FILTER.sent) {
        query.andWhere(
          `EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = thread.id
             AND m.direction = :outDir AND m.status = :sentStatus AND m.deleted_at IS NULL)`,
          { outDir: MAIL_DIRECTIONS.outbound, sentStatus: MAIL_MESSAGE_STATUSES.sent },
        );
      } else if (folder === MAIL_FOLDER_FILTER.drafts) {
        query.andWhere(
          `EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = thread.id
             AND m.status = :draftStatus AND m.deleted_at IS NULL)`,
          { draftStatus: MAIL_MESSAGE_STATUSES.draft },
        );
      }
    }

    if (dto.account_id) {
      query.andWhere('thread.account_id = :accountId', { accountId: dto.account_id });
    }

    if (dto.task_id) {
      query.andWhere('thread.task_id = :taskId', { taskId: dto.task_id });
    }

    if (dto.search) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where('thread.subject ILIKE :search', { search: `%${dto.search}%` }).orWhere(
            'thread.counterparty_address ILIKE :search',
            { search: `%${dto.search}%` },
          );
        }),
      );
    }

    const [threads, total] = await query.getManyAndCount();

    return { threads, total, page, limit };
  }

  async getThreadWithMessages(user: AuthenticatedUser, threadId: number) {
    const thread = await this.threadsRepository.findOne({
      where: { id: threadId },
      relations: { account: { allowedUsers: true } },
    });

    if (!thread) {
      throw new NotFoundException('Тред не найден');
    }

    if (!canAccessAccount(user, thread.account)) {
      throw new ForbiddenException('Нет доступа к этому ящику');
    }

    const messages = await this.messagesRepository.find({
      where: { thread_id: thread.id, deleted_at: IsNull() },
      relations: { attachments: true },
      order: { id: 'ASC' },
    });

    return { thread, messages };
  }

  async moveThreadToFolder(user: AuthenticatedUser, threadId: number, folder: MAIL_FOLDERS): Promise<MailThreads> {
    const { thread } = await this.getThreadWithMessages(user, threadId);

    thread.folder = folder;

    return this.threadsRepository.save(thread);
  }

  async deleteThreadPermanently(user: AuthenticatedUser, threadId: number): Promise<void> {
    const { thread } = await this.getThreadWithMessages(user, threadId);

    await this.threadsRepository.remove(thread);
  }

  async softDeleteMessage(user: AuthenticatedUser, messageId: number): Promise<void> {
    const message = await this.messagesRepository.findOne({
      where: { id: messageId },
      relations: { thread: { account: { allowedUsers: true } } },
    });

    if (!message) {
      throw new NotFoundException('Письмо не найдено');
    }

    if (!canAccessAccount(user, message.thread.account)) {
      throw new ForbiddenException('Нет доступа к этому письму');
    }

    message.deleted_at = new Date();
    await this.messagesRepository.save(message);
  }

  async saveDraft(user: AuthenticatedUser, dto: SaveDraftDto): Promise<MailMessages> {
    const account = await this.getAccountForUser(user, dto.account_id);
    const toAddresses = (dto.to ?? []).map((address) => ({ address }));
    const ccAddresses = (dto.cc ?? []).map((address) => ({ address }));

    if (dto.draft_id) {
      const draft = await this.messagesRepository.findOne({
        where: { id: dto.draft_id },
        relations: { thread: { account: { allowedUsers: true } } },
      });

      if (!draft || draft.status !== MAIL_MESSAGE_STATUSES.draft) {
        throw new NotFoundException('Черновик не найден');
      }
      if (!canAccessAccount(user, draft.thread.account)) {
        throw new ForbiddenException('Нет доступа к этому черновику');
      }

      draft.to_addresses = toAddresses;
      draft.cc_addresses = ccAddresses;
      draft.subject = dto.subject ?? null;
      draft.text_body = dto.text ?? null;
      draft.html_body = dto.html ?? null;
      draft.thread.counterparty_address = dto.to?.[0] ?? draft.thread.counterparty_address;
      await this.threadsRepository.save(draft.thread);

      const updated = await this.messagesRepository.save(draft);
      await this.syncOutboundAttachments(updated.id, dto.attachments);

      return updated;
    }

    const thread = await this.threadsRepository.save(
      this.threadsRepository.create({
        subject: dto.subject || '(черновик)',
        account_id: account.id,
        counterparty_address: dto.to?.[0] ?? null,
        last_message_at: new Date(),
        folder: MAIL_FOLDERS.inbox,
      }),
    );

    const created = await this.messagesRepository.save(
      this.messagesRepository.create({
        thread_id: thread.id,
        direction: MAIL_DIRECTIONS.outbound,
        from_address: account.address,
        from_name: account.display_name,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        subject: dto.subject ?? null,
        text_body: dto.text ?? null,
        html_body: dto.html ?? null,
        auth_results: null,
        is_read: true,
        status: MAIL_MESSAGE_STATUSES.draft,
        sent_by_user_id: user.id,
      }),
    );

    await this.syncOutboundAttachments(created.id, dto.attachments);

    return created;
  }

  async sendDraft(user: AuthenticatedUser, draftId: number): Promise<MailMessages> {
    const draft = await this.messagesRepository.findOne({
      where: { id: draftId },
      relations: { thread: { account: { allowedUsers: true } }, attachments: true },
    });

    if (!draft || draft.status !== MAIL_MESSAGE_STATUSES.draft) {
      throw new NotFoundException('Черновик не найден');
    }
    if (!canAccessAccount(user, draft.thread.account)) {
      throw new ForbiddenException('Нет доступа к этому черновику');
    }

    const to = draft.to_addresses.map((item) => item.address);
    if (to.length === 0) {
      throw new BadRequestException('У черновика не указан получатель');
    }

    const account = draft.thread.account;
    const cc = draft.cc_addresses.map((item) => item.address);
    const draftAttachments = (draft.attachments ?? []).map((item) => ({
      s3_key: item.s3_key,
      filename: item.filename,
      content_type: item.content_type,
    }));

    let sentMessageId: string;
    try {
      sentMessageId = await this.postboxService.send({
        from: { address: account.address, name: account.display_name },
        to,
        cc,
        subject: draft.subject ?? '',
        html: draft.html_body ?? undefined,
        text: draft.text_body ?? undefined,
        attachments: draftAttachments.length ? await this.buildPostboxAttachments(draftAttachments) : undefined,
      });
    } catch (error) {
      this.logger.error(`Ошибка отправки черновика ${draftId}: ${error}`);
      if (error instanceof Error && error.name === 'ServiceUnavailableException') {
        throw error;
      }
      throw new InternalServerErrorException('Не удалось отправить черновик');
    }

    draft.message_id = sentMessageId;
    draft.status = MAIL_MESSAGE_STATUSES.sent;
    draft.thread.last_message_at = new Date();
    await this.threadsRepository.save(draft.thread);

    return this.messagesRepository.save(draft);
  }

  async markThreadRead(user: AuthenticatedUser, threadId: number): Promise<void> {
    const { thread } = await this.getThreadWithMessages(user, threadId);

    await this.messagesRepository.update(
      { thread_id: thread.id, direction: MAIL_DIRECTIONS.inbound, is_read: false },
      { is_read: true },
    );
  }

  async linkThreadToTask(user: AuthenticatedUser, threadId: number, taskId: number | null): Promise<MailThreads> {
    const { thread } = await this.getThreadWithMessages(user, threadId);

    thread.task_id = taskId;

    return this.threadsRepository.save(thread);
  }

  async getAttachmentForUser(user: AuthenticatedUser, attachmentId: number) {
    const attachment = await this.attachmentsRepository.findOne({
      where: { id: attachmentId },
      relations: { message: { thread: { account: { allowedUsers: true } } } },
    });

    if (!attachment) {
      throw new NotFoundException('Вложение не найдено');
    }

    if (!canAccessAccount(user, attachment.message.thread.account)) {
      throw new ForbiddenException('Нет доступа к этому вложению');
    }

    const stream = await this.storageService.getObjectStream(attachment.s3_key);

    return { attachment, stream };
  }

  async getUnreadCount(user: AuthenticatedUser): Promise<number> {
    const query = this.messagesRepository
      .createQueryBuilder('message')
      .innerJoin('message.thread', 'thread')
      .innerJoin('thread.account', 'account')
      .where('message.is_read = false')
      .andWhere('message.direction = :inbound', { inbound: MAIL_DIRECTIONS.inbound });

    query.andWhere('account.id IN (SELECT mail_account_id FROM mail_account_access WHERE user_id = :userId)', {
      userId: user.id,
    });

    return query.getCount();
  }
}
