import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MailDeliveryStatus, MailSpamRuleScope, MailSystemFolder, type MailUnreadCounts } from '@tracker/contracts';
import { Brackets, ILike, In, IsNull, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Notifications } from '../notifications/entities/notification.entity';
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
import { MailFolders } from './entities/mail-folder.entity';
import { MailSpamRules } from './entities/mail-spam-rule.entity';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailThreads, MAIL_FOLDERS } from './entities/mail-thread.entity';
import { Users } from '../users/entities/users.entity';
import { InboundMailData } from './mailbox.types';
import { buildReferencesHeader, canAccessAccount, extractReferencedIds, parseTaskIdFromAddress } from './mailbox.utils';
import { MailDeliveryService } from './mail-delivery.service';
import { MailSpamService } from './mail-spam.service';
import { PostboxService } from './postbox.service';
import { CreateMailFolderDto } from './dto/create-mail-folder.dto';
import { MoveMailThreadDto } from './dto/move-mail-thread.dto';
import { UpdateMailFolderDto } from './dto/update-mail-folder.dto';
import { MarkMailSpamDto } from './dto/mark-mail-spam.dto';

const DEFAULT_THREADS_LIMIT = 30;
const MAX_THREADS_LIMIT = 100;
const MAX_OUTBOUND_ATTACHMENTS_BYTES = 7_000_000;
const OUTBOUND_ATTACHMENTS_TOO_LARGE_MESSAGE = 'Вложения занимают больше 7 МБ. Уменьшите файлы или отправьте ссылку на них.';
const RESERVED_FOLDER_NAMES = new Set(['входящие', 'отправленные', 'черновики', 'спам', 'корзина', 'статистика']);
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'yandex.ru',
  'ya.ru',
  'rambler.ru',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
]);

@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);

  constructor(
    @InjectRepository(MailAccounts)
    private readonly accountsRepository: Repository<MailAccounts>,
    @InjectRepository(MailThreads)
    private readonly threadsRepository: Repository<MailThreads>,
    @InjectRepository(MailFolders)
    private readonly foldersRepository: Repository<MailFolders>,
    @InjectRepository(MailSpamRules)
    private readonly spamRulesRepository: Repository<MailSpamRules>,
    @InjectRepository(MailMessages)
    private readonly messagesRepository: Repository<MailMessages>,
    @InjectRepository(MailAttachments)
    private readonly attachmentsRepository: Repository<MailAttachments>,
    @InjectRepository(Notifications)
    private readonly notificationsRepository: Repository<Notifications>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly storageService: StorageService,
    private readonly postboxService: PostboxService,
    private readonly mailDeliveryService: MailDeliveryService,
    private readonly mailSpamService: MailSpamService,
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

  async listFolders(user: AuthenticatedUser, accountId: number): Promise<MailFolders[]> {
    await this.getAccountForUser(user, accountId);
    return this.foldersRepository.find({ where: { account_id: accountId }, order: { name: 'ASC' } });
  }

  async createFolder(user: AuthenticatedUser, dto: CreateMailFolderDto): Promise<MailFolders> {
    await this.getAccountForUser(user, dto.account_id);
    const name = this.normalizeFolderName(dto.name);
    await this.assertFolderNameAvailable(dto.account_id, name);

    return this.foldersRepository.save(this.foldersRepository.create({ account_id: dto.account_id, name }));
  }

  async updateFolder(user: AuthenticatedUser, folderId: number, dto: UpdateMailFolderDto): Promise<MailFolders> {
    const folder = await this.getFolderForUser(user, folderId);
    const name = this.normalizeFolderName(dto.name);
    await this.assertFolderNameAvailable(folder.account_id, name, folder.id);
    folder.name = name;
    return this.foldersRepository.save(folder);
  }

  async deleteFolder(user: AuthenticatedUser, folderId: number): Promise<void> {
    const folder = await this.getFolderForUser(user, folderId);
    await this.threadsRepository.update(
      { custom_folder_id: folder.id },
      { custom_folder_id: null, folder: MailSystemFolder.INBOX },
    );
    await this.foldersRepository.remove(folder);
  }

  private normalizeFolderName(value: string): string {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Введите название папки');
    if (RESERVED_FOLDER_NAMES.has(name.toLowerCase())) {
      throw new BadRequestException('Это название занято системной папкой');
    }
    return name;
  }

  private async assertFolderNameAvailable(accountId: number, name: string, exceptId?: number): Promise<void> {
    const existing = await this.foldersRepository.findOne({ where: { account_id: accountId, name: ILike(name) } });
    if (existing && existing.id !== exceptId) throw new BadRequestException(`Папка «${name}» уже существует`);
  }

  private async getFolderForUser(user: AuthenticatedUser, folderId: number): Promise<MailFolders> {
    const folder = await this.foldersRepository.findOne({
      where: { id: folderId },
      relations: { account: { allowedUsers: true } },
    });
    if (!folder) throw new NotFoundException('Папка не найдена');
    if (!canAccessAccount(user, folder.account)) throw new ForbiddenException('Нет доступа к этой папке');
    return folder;
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
    const linkedNotification = await this.findLinkedNotification(account.address, data.notificationId);
    const notificationAlreadyRead = linkedNotification?.is_read === true;
    const matchingSpamRule = linkedNotification ? null : await this.findMatchingSpamRule(account.id, data.from.address);
    const spam = linkedNotification
      ? { isSpam: false, score: 0, reasons: [] }
      : matchingSpamRule
        ? {
            isSpam: true,
            score: 100,
            reasons: [
              matchingSpamRule.scope === MailSpamRuleScope.DOMAIN
                ? `Домен ${matchingSpamRule.value} заблокирован пользователем`
                : `Отправитель ${matchingSpamRule.value} заблокирован пользователем`,
            ],
          }
        : this.mailSpamService.assess(data);

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        thread_id: thread.id,
        notification_id: linkedNotification?.id ?? null,
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
        is_spam: spam.isSpam,
        spam_score: spam.score,
        spam_reasons: spam.reasons,
        is_read: notificationAlreadyRead,
        status: MAIL_MESSAGE_STATUSES.received,
      }),
    );

    await this.saveAttachments(account, thread, message, data);

    const receivedAt = new Date();
    thread.last_message_at = receivedAt;
    thread.last_inbound_at = receivedAt;
    if (notificationAlreadyRead) {
      thread.folder = MAIL_FOLDERS.trash;
      thread.custom_folder_id = null;
    } else if (spam.isSpam && !thread.custom_folder_id && thread.folder === MAIL_FOLDERS.inbox) {
      thread.folder = MAIL_FOLDERS.spam;
    }
    if (!thread.counterparty_address) {
      thread.counterparty_address = data.from.address;
    }
    await this.threadsRepository.save(thread);

    if (!spam.isSpam) {
      await this.notifyInboundMessage(account.id, thread.id, message.id, data);
    }

    return message;
  }

  private senderDomain(address: string): string | null {
    const normalized = this.normalizeEmail(address);
    const separator = normalized.lastIndexOf('@');
    return separator > 0 && separator < normalized.length - 1 ? normalized.slice(separator + 1) : null;
  }

  private findMatchingSpamRule(accountId: number, address: string): Promise<MailSpamRules | null> {
    const sender = this.normalizeEmail(address);
    const domain = this.senderDomain(sender);
    const where = [{ account_id: accountId, scope: MailSpamRuleScope.SENDER, value: sender }];
    if (domain) where.push({ account_id: accountId, scope: MailSpamRuleScope.DOMAIN, value: domain });
    return this.spamRulesRepository.findOne({ where });
  }

  private findLinkedNotification(accountAddress: string, notificationId: number | null): Promise<Notifications | null> {
    if (!notificationId) return Promise.resolve(null);

    return this.notificationsRepository
      .createQueryBuilder('notification')
      .innerJoinAndSelect('notification.recipient', 'recipient')
      .where('notification.id = :notificationId', { notificationId })
      .andWhere('LOWER(recipient.email) = :accountAddress', { accountAddress: accountAddress.toLowerCase() })
      .getOne();
  }

  async moveNotificationThreadsToTrash(userId: number, notificationIds: number[]): Promise<number[]> {
    if (notificationIds.length === 0) return [];

    const rows = await this.messagesRepository
      .createQueryBuilder('message')
      .select('DISTINCT message.thread_id', 'thread_id')
      .innerJoin(Notifications, 'notification', 'notification.id = message.notification_id')
      .innerJoin('notification.recipient', 'recipient')
      .where('message.notification_id IN (:...notificationIds)', { notificationIds })
      .andWhere('recipient.id = :userId', { userId })
      .getRawMany<{ thread_id: number | string }>();
    const threadIds = rows.map((row) => Number(row.thread_id)).filter((id) => Number.isInteger(id) && id > 0);

    if (threadIds.length === 0) return [];

    await this.messagesRepository.update(
      {
        thread_id: In(threadIds),
        direction: MAIL_DIRECTIONS.inbound,
        is_read: false,
      },
      { is_read: true },
    );
    await this.threadsRepository.update({ id: In(threadIds) }, { folder: MAIL_FOLDERS.trash, custom_folder_id: null });

    return threadIds;
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
        last_inbound_at: new Date(),
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
    const encodedOriginalName = file.originalname as string | undefined;
    const original = encodedOriginalName ? Buffer.from(encodedOriginalName, 'latin1').toString('utf8') : 'file';
    const safeName = original.replace(/[^\wа-яА-ЯёЁ.-]+/g, '_').slice(0, 200);
    const key = `mailbox/outbound/${randomUUID()}-${safeName}`;
    const contentType = file.mimetype || 'application/octet-stream';

    await this.storageService.uploadObject(key, file.buffer, contentType);

    return { s3_key: key, filename: original, content_type: contentType, size: file.size };
  }

  private async buildPostboxAttachments(
    items: { s3_key: string; filename: string; content_type: string; content_id?: string | null; is_inline?: boolean }[],
  ): Promise<{ filename: string; content: Readable; contentType: string; cid?: string; contentDisposition?: 'inline' }[]> {
    const result: {
      filename: string;
      content: Readable;
      contentType: string;
      cid?: string;
      contentDisposition?: 'inline';
    }[] = [];
    for (const item of items) {
      const stream = await this.storageService.getObjectStream(item.s3_key);
      const contentId = item.content_id?.replace(/^<|>$/g, '');
      result.push({
        filename: item.filename,
        content: stream.body,
        contentType: item.content_type,
        ...(contentId ? { cid: contentId } : {}),
        ...(item.is_inline ? { contentDisposition: 'inline' as const } : {}),
      });
    }
    return result;
  }

  private async syncOutboundAttachments(messageId: number, items?: MailAttachmentInputDto[]): Promise<MailAttachments[]> {
    await this.attachmentsRepository.delete({ message_id: messageId });
    if (!items?.length) {
      return [];
    }
    return this.attachmentsRepository.save(
      items.map((item) =>
        this.attachmentsRepository.create({
          message_id: messageId,
          filename: item.filename,
          content_type: item.content_type,
          size: item.size,
          s3_key: item.s3_key,
          content_id: item.content_id ?? null,
          is_inline: item.is_inline ?? false,
        }),
      ),
    );
  }

  private assertOutboundAttachmentsSize(items?: Pick<MailAttachmentInputDto, 'size'>[]): void {
    const attachmentsSize = (items ?? []).reduce((total, attachment) => total + attachment.size, 0);

    if (attachmentsSize > MAX_OUTBOUND_ATTACHMENTS_BYTES) {
      throw new PayloadTooLargeException(OUTBOUND_ATTACHMENTS_TOO_LARGE_MESSAGE);
    }
  }

  private rethrowPostboxError(error: Error, fallbackMessage: string): never {
    if (error.name === 'ServiceUnavailableException') {
      throw error;
    }

    if (error.message.includes('message size quota exceeded')) {
      throw new PayloadTooLargeException(OUTBOUND_ATTACHMENTS_TOO_LARGE_MESSAGE);
    }

    throw new InternalServerErrorException(fallbackMessage);
  }

  async sendMail(user: AuthenticatedUser, dto: SendMailDto): Promise<MailMessages> {
    const account = await this.getAccountForUser(user, dto.account_id);
    this.assertOutboundAttachmentsSize(dto.attachments);

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

    let sendResult: { messageId: string; providerMessageId: string | null };

    try {
      sendResult = await this.postboxService.send({
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

      if (error instanceof Error) {
        this.rethrowPostboxError(error, 'Не удалось отправить письмо');
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
        message_id: sendResult.messageId,
        provider_message_id: sendResult.providerMessageId,
        delivery_status: MailDeliveryStatus.SENT,
        open_count: 0,
        click_count: 0,
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

    const attachments = await this.syncOutboundAttachments(message.id, dto.attachments);

    return { ...message, attachments };
  }

  async findThreads(user: AuthenticatedUser, dto: FindThreadsDto) {
    await this.getAccountForUser(user, dto.account_id);
    const limit = Math.min(dto.limit ?? DEFAULT_THREADS_LIMIT, MAX_THREADS_LIMIT);
    const page = dto.page ?? 1;

    const query = this.threadsRepository
      .createQueryBuilder('thread')
      .innerJoinAndSelect('thread.account', 'account')
      .loadRelationCountAndMap('thread.unread_count', 'thread.messages', 'unread', (qb) =>
        qb.where('unread.is_read = false AND unread.direction = :inbound', { inbound: MAIL_DIRECTIONS.inbound }),
      )
      .skip((page - 1) * limit)
      .take(limit);

    query.andWhere('account.id IN (SELECT mail_account_id FROM mail_account_access WHERE user_id = :userId)', {
      userId: user.id,
    });

    const folder = dto.folder ?? MAIL_FOLDER_FILTER.inbox;
    if (dto.custom_folder_id) {
      const customFolder = await this.getFolderForUser(user, dto.custom_folder_id);
      if (customFolder.account_id !== dto.account_id) throw new BadRequestException('Папка не относится к выбранному ящику');
      query.andWhere('thread.custom_folder_id = :customFolderId', { customFolderId: customFolder.id });
    } else if (folder === MAIL_FOLDER_FILTER.trash) {
      query.andWhere('thread.folder = :trashFolder', { trashFolder: MAIL_FOLDERS.trash });
      query.andWhere('thread.custom_folder_id IS NULL');
    } else if (folder === MAIL_FOLDER_FILTER.spam) {
      query.andWhere('thread.folder = :spamFolder', { spamFolder: MAIL_FOLDERS.spam });
      query.andWhere('thread.custom_folder_id IS NULL');
    } else {
      query.andWhere('thread.folder = :inboxFolder', { inboxFolder: MAIL_FOLDERS.inbox });
      query.andWhere('thread.custom_folder_id IS NULL');

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

    query.andWhere('thread.account_id = :accountId', { accountId: dto.account_id });

    if (!dto.custom_folder_id && folder === MAIL_FOLDER_FILTER.inbox) {
      query.orderBy('thread.last_inbound_at', 'DESC', 'NULLS LAST');
    } else {
      query.orderBy('thread.last_message_at', 'DESC');
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
    const avatarByAddress = await this.getUserAvatarMap(threads.map((thread) => thread.counterparty_address));
    const deliveryByThread =
      folder === MAIL_FOLDER_FILTER.sent
        ? await this.mailDeliveryService.attachDeliverySummaries(threads.map((thread) => thread.id))
        : null;

    return {
      threads: threads.map((thread) => {
        const delivery = deliveryByThread?.get(thread.id);
        return {
          ...thread,
          list_activity_at:
            !dto.custom_folder_id && folder === MAIL_FOLDER_FILTER.inbox
              ? (thread.last_inbound_at ?? thread.last_message_at)
              : thread.last_message_at,
          counterparty_avatar_url: avatarByAddress.get(this.normalizeEmail(thread.counterparty_address)) ?? null,
          delivery_status: delivery?.delivery_status ?? null,
          open_count: delivery?.open_count ?? 0,
          click_count: delivery?.click_count ?? 0,
        };
      }),
      total,
      page,
      limit,
    };
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
    const avatarByAddress = await this.getUserAvatarMap([
      thread.counterparty_address,
      ...messages.map((message) => message.from_address),
    ]);

    return {
      thread: {
        ...thread,
        counterparty_avatar_url: avatarByAddress.get(this.normalizeEmail(thread.counterparty_address)) ?? null,
      },
      messages: messages.map((message) => ({
        ...message,
        sender_avatar_url: avatarByAddress.get(this.normalizeEmail(message.from_address)) ?? null,
      })),
    };
  }

  private normalizeEmail(address: string | null): string {
    return (address ?? '').trim().toLowerCase();
  }

  private async getUserAvatarMap(addresses: (string | null)[]): Promise<Map<string, string>> {
    const normalizedAddresses = [...new Set(addresses.map((address) => this.normalizeEmail(address)).filter(Boolean))];
    if (normalizedAddresses.length === 0) {
      return new Map();
    }

    const users = await this.usersRepository
      .createQueryBuilder('user')
      .select(['user.email', 'user.photo_url'])
      .where('LOWER(user.email) IN (:...addresses)', { addresses: normalizedAddresses })
      .andWhere('user.photo_url IS NOT NULL')
      .getMany();

    return new Map(
      users.filter((user) => user.email && user.photo_url).map((user) => [this.normalizeEmail(user.email), user.photo_url]),
    );
  }

  async moveThreadToFolder(user: AuthenticatedUser, threadId: number, target: MoveMailThreadDto): Promise<MailThreads> {
    const { thread } = await this.getThreadWithMessages(user, threadId);

    const hasSystemFolder = target.system_folder !== undefined;
    const hasCustomFolder = target.custom_folder_id !== undefined;
    if (hasSystemFolder === hasCustomFolder) {
      throw new BadRequestException('Укажите одну целевую папку');
    }

    if (target.custom_folder_id !== undefined) {
      const folder = await this.getFolderForUser(user, target.custom_folder_id);
      if (folder.account_id !== thread.account_id) throw new BadRequestException('Папка не относится к ящику переписки');
      thread.folder = MailSystemFolder.INBOX;
      thread.custom_folder_id = folder.id;
    } else {
      thread.folder = target.system_folder!;
      thread.custom_folder_id = null;
    }

    return this.threadsRepository.save(thread);
  }

  async markThreadAsSpam(user: AuthenticatedUser, threadId: number, dto: MarkMailSpamDto) {
    const { thread, messages } = await this.getThreadWithMessages(user, threadId);
    const inbound = [...messages].reverse().find((message) => message.direction === MAIL_DIRECTIONS.inbound);
    if (!inbound) throw new BadRequestException('В переписке нет входящего отправителя');

    const sender = this.normalizeEmail(inbound.from_address);
    const domain = this.senderDomain(sender);
    if (dto.scope === MailSpamRuleScope.DOMAIN && (!domain || PUBLIC_MAIL_DOMAINS.has(domain))) {
      throw new BadRequestException('Нельзя заблокировать общедоступный почтовый домен целиком');
    }
    const value = dto.scope === MailSpamRuleScope.DOMAIN ? domain! : sender;
    const existing = await this.spamRulesRepository.findOne({
      where: { account_id: thread.account_id, scope: dto.scope, value },
    });
    const rule =
      existing ??
      (await this.spamRulesRepository.save(
        this.spamRulesRepository.create({ account_id: thread.account_id, scope: dto.scope, value }),
      ));

    const matchingMessages = await this.messagesRepository
      .createQueryBuilder('message')
      .select('message.thread_id', 'thread_id')
      .innerJoin('message.thread', 'thread')
      .where('thread.account_id = :accountId', { accountId: thread.account_id })
      .andWhere('message.direction = :direction', { direction: MAIL_DIRECTIONS.inbound })
      .andWhere('message.deleted_at IS NULL')
      .andWhere(
        dto.scope === MailSpamRuleScope.DOMAIN
          ? 'LOWER(message.from_address) LIKE :senderPattern'
          : 'LOWER(message.from_address) = :senderPattern',
        { senderPattern: dto.scope === MailSpamRuleScope.DOMAIN ? `%@${value}` : value },
      )
      .getRawMany<{ thread_id: number | string }>();
    const threadIds = [...new Set([thread.id, ...matchingMessages.map((item) => Number(item.thread_id))])].filter(
      Number.isInteger,
    );
    await this.threadsRepository.update({ id: In(threadIds) }, { folder: MailSystemFolder.SPAM, custom_folder_id: null });

    return { rule, moved_thread_count: threadIds.length };
  }

  async markThreadAsNotSpam(user: AuthenticatedUser, threadId: number): Promise<MailThreads> {
    const { thread, messages } = await this.getThreadWithMessages(user, threadId);
    const inbound = [...messages].reverse().find((message) => message.direction === MAIL_DIRECTIONS.inbound);
    if (inbound) {
      const sender = this.normalizeEmail(inbound.from_address);
      const domain = this.senderDomain(sender);
      await this.spamRulesRepository.delete({
        account_id: thread.account_id,
        scope: MailSpamRuleScope.SENDER,
        value: sender,
      });
      if (domain) {
        await this.spamRulesRepository.delete({
          account_id: thread.account_id,
          scope: MailSpamRuleScope.DOMAIN,
          value: domain,
        });
      }
    }

    thread.folder = MailSystemFolder.INBOX;
    thread.custom_folder_id = null;
    return this.threadsRepository.save(thread);
  }

  async retryMessage(user: AuthenticatedUser, messageId: number): Promise<MailMessages> {
    const message = await this.messagesRepository.findOne({
      where: { id: messageId },
      relations: { attachments: true, thread: { account: { allowedUsers: true } } },
    });
    if (!message) throw new NotFoundException('Письмо не найдено');
    if (!canAccessAccount(user, message.thread.account)) throw new ForbiddenException('Нет доступа к этому письму');
    const canRetry =
      message.direction === MAIL_DIRECTIONS.outbound &&
      (message.status === MAIL_MESSAGE_STATUSES.failed || message.delivery_status === MailDeliveryStatus.BOUNCED);
    if (!canRetry) throw new BadRequestException('Повторная отправка доступна только для недоставленного письма');

    return this.sendMail(user, {
      account_id: message.thread.account_id,
      to: message.to_addresses.map((item) => item.address),
      cc: message.cc_addresses.map((item) => item.address),
      subject: message.subject ?? message.thread.subject,
      text: message.text_body ?? undefined,
      html: message.html_body ?? undefined,
      thread_id: message.thread_id,
      attachments: (message.attachments ?? []).map((attachment) => ({
        s3_key: attachment.s3_key,
        filename: attachment.filename,
        content_type: attachment.content_type,
        size: attachment.size,
        content_id: attachment.content_id,
        is_inline: attachment.is_inline,
      })),
    });
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
      draft.from_address = account.address;
      draft.from_name = account.display_name;
      draft.thread.subject = dto.subject || '(черновик)';
      draft.thread.account_id = account.id;
      draft.thread.account = account;
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
    this.assertOutboundAttachmentsSize(draft.attachments);
    const draftAttachments = (draft.attachments ?? []).map((item) => ({
      s3_key: item.s3_key,
      filename: item.filename,
      content_type: item.content_type,
    }));

    let sendResult: { messageId: string; providerMessageId: string | null };
    try {
      sendResult = await this.postboxService.send({
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
      if (error instanceof Error) {
        this.rethrowPostboxError(error, 'Не удалось отправить черновик');
      }
      throw new InternalServerErrorException('Не удалось отправить черновик');
    }

    draft.message_id = sendResult.messageId;
    draft.provider_message_id = sendResult.providerMessageId;
    draft.delivery_status = MailDeliveryStatus.SENT;
    draft.open_count = 0;
    draft.click_count = 0;
    draft.first_opened_at = null;
    draft.last_delivery_event_at = null;
    draft.status = MAIL_MESSAGE_STATUSES.sent;
    draft.thread.subject = draft.subject || '(без темы)';
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

  async getUnreadCounts(user: AuthenticatedUser, accountId?: number): Promise<MailUnreadCounts> {
    const query = this.messagesRepository
      .createQueryBuilder('message')
      .select('thread.folder', 'folder')
      .addSelect('COUNT(message.id)', 'count')
      .innerJoin('message.thread', 'thread')
      .innerJoin('thread.account', 'account')
      .where('message.is_read = false')
      .andWhere('message.direction = :inbound', { inbound: MAIL_DIRECTIONS.inbound })
      .andWhere('thread.custom_folder_id IS NULL')
      .groupBy('thread.folder');

    query.andWhere('account.id IN (SELECT mail_account_id FROM mail_account_access WHERE user_id = :userId)', {
      userId: user.id,
    });

    if (accountId) {
      await this.getAccountForUser(user, accountId);
      query.andWhere('thread.account_id = :accountId', { accountId });
    }

    const rows = await query.getRawMany<{ folder: MAIL_FOLDERS; count: string }>();
    const counts: MailUnreadCounts = { count: 0, inbox: 0, spam: 0, trash: 0 };

    for (const row of rows) {
      const count = Number(row.count) || 0;
      if (row.folder === MAIL_FOLDERS.inbox) counts.inbox = count;
      if (row.folder === MAIL_FOLDERS.spam) counts.spam = count;
      if (row.folder === MAIL_FOLDERS.trash) counts.trash = count;
    }

    counts.count = counts.inbox;

    return counts;
  }
}
