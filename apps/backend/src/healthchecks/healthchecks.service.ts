import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as https from 'https';
import * as http from 'http';
import { HealthCheck, HealthCheckStatus } from './entities/healthcheck.entity';
import { CreateHealthCheckDto } from './dto/create-healthcheck.dto';
import { UpdateHealthCheckDto } from './dto/update-healthcheck.dto';
import { ChatsService } from '../chats/chats.service';
import { TenantContextService, runTenantSavepoint } from '../tenancy/tenant-context.service';
import { TenantJobsService, TenantJob } from '../tenancy/tenant-jobs.service';
import { parseAllowedHosts, resolvePublicEndpoint, validatePublicEndpoint } from '../common/network/public-endpoint';
import { ChatMember } from '../chats/entities/chat-member.entity';
import { Users } from '../users/entities/users.entity';

@Injectable()
export class HealthchecksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthchecksService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();

  constructor(
    @InjectRepository(HealthCheck)
    private readonly healthcheckRepository: Repository<HealthCheck>,
    private readonly chatsService: ChatsService,
    private readonly context: TenantContextService,
    private readonly jobs: TenantJobsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.context.isEnabled()) {
      this.jobs.register('healthchecks.probe', (job) => this.runTenantCheck(job));
      this.jobs.schedule('healthchecks.probe', () => this.scheduleTenantChecks());
      return;
    }
    const active = await this.healthcheckRepository.findBy({ is_active: true });
    for (const hc of active) {
      this.startTimer(hc);
    }
    this.logger.log(`Запущено ${active.length} healthcheck-мониторов`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  async findAll(): Promise<HealthCheck[]> {
    this.assertTenantAccess();
    return this.healthcheckRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<HealthCheck> {
    this.assertTenantAccess();
    const hc = await this.healthcheckRepository.findOneBy({ id });
    if (!hc) throw new NotFoundException(`Healthcheck #${id} не найден`);
    return hc;
  }

  async create(dto: CreateHealthCheckDto): Promise<HealthCheck> {
    this.assertTenantAccess(true);
    if (this.context.isEnabled()) {
      const { manager, tenant } = this.context.require();
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenant.id}:healthchecks`]);
      const limit = Number(process.env.HEALTHCHECK_TENANT_LIMIT ?? 100);
      if (!Number.isSafeInteger(limit) || limit < 1 || (await this.healthcheckRepository.count()) >= limit) {
        throw new BadRequestException('Достигнут лимит мониторов пространства');
      }
      await this.validateTenantMonitor(dto);
    }
    const hc = this.healthcheckRepository.create(dto);
    const saved = await this.healthcheckRepository.save(hc);
    if (saved.is_active) {
      this.startTimer(saved);
    }
    return saved;
  }

  async update(id: number, dto: UpdateHealthCheckDto): Promise<HealthCheck> {
    this.assertTenantAccess(true);
    const hc = await this.findOne(id);
    if (this.context.isEnabled()) await this.validateTenantMonitor({ ...hc, ...dto });
    this.stopTimer(id);

    Object.assign(hc, dto);
    const saved = await this.healthcheckRepository.save(hc);

    if (saved.is_active) {
      this.startTimer(saved);
    }
    return saved;
  }

  async remove(id: number): Promise<void> {
    this.assertTenantAccess(true);
    this.stopTimer(id);
    await this.healthcheckRepository.delete(id);
  }

  async toggle(id: number): Promise<HealthCheck> {
    const hc = await this.findOne(id);
    return this.update(id, { is_active: !hc.is_active });
  }

  private startTimer(hc: HealthCheck): void {
    if (this.context.isEnabled()) return;
    this.stopTimer(hc.id);
    const timer = setInterval(() => {
      this.runCheck(hc.id).catch((err: Error) => {
        const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
        this.logger.error(`Ошибка при выполнении проверки #${hc.id}: ${errorMessage}`);
      });
    }, hc.interval_seconds * 1000);
    this.timers.set(hc.id, timer);
    this.logger.log(`Монитор #${hc.id} "${hc.name}" запущен (каждые ${hc.interval_seconds}с)`);
  }

  private stopTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private async runCheck(id: number): Promise<void> {
    this.assertTenantAccess(true);
    const hc = await this.healthcheckRepository.findOneBy({ id });
    if (!hc || !hc.is_active) return;

    const prevStatus = hc.last_status;
    let newStatus: HealthCheckStatus;
    let error: string | null = null;

    try {
      const statusCode = await this.httpGet(hc.url, hc.timeout_seconds);
      if (statusCode === hc.expected_status) {
        newStatus = HealthCheckStatus.OK;
      } else {
        newStatus = HealthCheckStatus.FAIL;
        error = `HTTP ${statusCode} (ожидался ${hc.expected_status})`;
      }
    } catch (err) {
      newStatus = HealthCheckStatus.FAIL;
      error = (err instanceof Error ? err.message : 'Неизвестная ошибка').slice(0, 500);
    }

    hc.last_status = newStatus;
    hc.last_checked_at = new Date();
    hc.last_error = error;
    await this.healthcheckRepository.save(hc);

    this.logger.log(`Monitor ${hc.id}: ${newStatus}`);

    if (newStatus === HealthCheckStatus.FAIL && prevStatus !== HealthCheckStatus.FAIL) {
      await this.sendAlert(hc, error ?? 'Неизвестная ошибка', false);
    } else if (newStatus === HealthCheckStatus.OK && prevStatus === HealthCheckStatus.FAIL) {
      await this.sendAlert(hc, '', true);
    }
  }

  private async httpGet(url: string, timeoutSeconds: number): Promise<number> {
    if (this.context.isEnabled()) return this.publicHttpGet(url, Math.min(timeoutSeconds, 20));
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.setTimeout(timeoutSeconds * 1000, () => {
        req.destroy(new Error(`Таймаут ${timeoutSeconds}с`));
      });
      req.end();
    });
  }

  private assertTenantAccess(write = false): void {
    if (!this.context.isEnabled()) return;
    const { tenant } = this.context.require();
    if (tenant.featureFlags.healthchecks !== true) throw new ForbiddenException('Мониторинг отключен для пространства');
    if (write && tenant.readOnly) throw new ForbiddenException('Пространство доступно только для чтения');
  }

  private async validateTenantMonitor(dto: CreateHealthCheckDto): Promise<void> {
    validatePublicEndpoint(dto.url, { allowedHosts: parseAllowedHosts(process.env.HEALTHCHECK_ALLOWED_HOSTS) });
    if ((dto.timeout_seconds ?? 10) > 20) throw new BadRequestException('Максимальный таймаут в облачной версии: 20 секунд');
    const { manager, actorId } = this.context.require();
    const members = manager.getRepository(ChatMember);
    const sender = await manager.getRepository(Users).findOneBy({ id: dto.sender_user_id });
    const senderMember = await members.findOneBy({ chat_id: dto.chat_id, user_id: dto.sender_user_id, left_at: IsNull() });
    const actorMember = actorId ? await members.findOneBy({ chat_id: dto.chat_id, user_id: actorId, left_at: IsNull() }) : null;
    if (!sender || !senderMember || !actorMember) {
      throw new ForbiddenException('Чат и отправитель должны быть доступны в текущем пространстве');
    }
  }

  private async scheduleTenantChecks(): Promise<void> {
    const { tenant, manager } = this.context.require();
    if (tenant.readOnly || tenant.featureFlags.healthchecks !== true) return;
    // Probes run frequently; retain completed dispatch records for one hour,
    // without touching failed jobs or other modules' idempotency records.
    await manager.query(`DELETE FROM tenant_jobs WHERE id IN (
      SELECT id FROM tenant_jobs WHERE kind = 'healthchecks.probe' AND status = 'completed'
      AND completed_at < now() - interval '1 hour' ORDER BY completed_at LIMIT 500
    )`);
    const rows = await manager.query<Array<{ id: number; interval_seconds: number }>>(`
      SELECT h.id, h.interval_seconds FROM healthchecks h
      WHERE h.is_active AND (h.last_checked_at IS NULL
        OR h.last_checked_at <= (now() AT TIME ZONE 'UTC') - h.interval_seconds * interval '1 second')
      AND NOT EXISTS (SELECT 1 FROM tenant_jobs j WHERE j.kind = 'healthchecks.probe'
        AND j.status = 'pending' AND j.payload->>'id' = h.id::text)
      ORDER BY h.last_checked_at NULLS FIRST, h.id LIMIT 50
    `);
    for (const row of rows) {
      await this.jobs.enqueue(
        'healthchecks.probe',
        `healthchecks:${row.id}:${Math.floor(Date.now() / (row.interval_seconds * 1000))}`,
        { id: row.id },
      );
    }
  }

  private async runTenantCheck(job: TenantJob): Promise<void> {
    const { tenant, manager } = this.context.require();
    if (tenant.readOnly || tenant.featureFlags.healthchecks !== true) return;
    const id = job.payload.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid monitor job');
    const rows = await manager.query<Array<{ id: number }>>(
      `
      SELECT id FROM healthchecks WHERE id = $1 AND is_active
      AND (last_checked_at IS NULL OR last_checked_at <= (now() AT TIME ZONE 'UTC') - interval_seconds * interval '1 second')
      FOR UPDATE SKIP LOCKED
    `,
      [id],
    );
    if (rows.length) await this.runCheck(id);
  }

  private async publicHttpGet(rawUrl: string, timeoutSeconds: number): Promise<number> {
    const endpoint = await resolvePublicEndpoint(rawUrl, {
      allowedHosts: parseAllowedHosts(process.env.HEALTHCHECK_ALLOWED_HOSTS),
    });
    return new Promise((resolve, reject) => {
      const lib = endpoint.url.protocol === 'https:' ? https : http;
      // Connect to the checked IP directly. Keep original Host/SNI for certificate
      // validation; do not follow redirects, proxies or a second DNS lookup.
      const options: https.RequestOptions = {
        protocol: endpoint.url.protocol,
        hostname: endpoint.address,
        family: endpoint.family,
        port: endpoint.url.protocol === 'https:' ? 443 : 80,
        servername: endpoint.url.hostname,
        method: 'GET',
        path: `${endpoint.url.pathname}${endpoint.url.search}`,
        headers: { Host: endpoint.url.host, 'User-Agent': 'Nervion-Monitor/1', Connection: 'close' },
        agent: false,
        maxHeaderSize: 16_384,
        rejectUnauthorized: true,
      };
      const req = lib.request(options, (response) => {
        clearTimeout(deadline);
        resolve(response.statusCode ?? 0);
        response.destroy(); // Status-only monitoring never downloads response bodies.
      });
      const deadline = setTimeout(() => req.destroy(new Error(`Таймаут ${timeoutSeconds}с`)), timeoutSeconds * 1000);
      deadline.unref();
      req.on('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      req.end();
    });
  }

  private async sendAlert(hc: HealthCheck, reason: string, isRecovery: boolean): Promise<void> {
    const emoji = isRecovery ? '🟢' : '🔴';
    const title = isRecovery ? `${emoji} Мониторинг: восстановлен` : `${emoji} Мониторинг: недоступен`;

    const items = isRecovery
      ? [
          this.bulletItem('Сервис: ', hc.name),
          this.bulletItem('URL: ', hc.url),
          this.bulletItem('Время: ', new Date().toISOString()),
        ]
      : [
          this.bulletItem('Сервис: ', hc.name),
          this.bulletItem('URL: ', hc.url),
          this.bulletItem('Причина: ', reason),
          this.bulletItem('Время: ', new Date().toISOString()),
        ];

    const message = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 3, textAlign: null },
          content: [{ type: 'text', text: title }],
        },
        {
          type: 'bulletList',
          content: items,
        },
      ],
    };

    try {
      if (this.context.isEnabled()) {
        if (this.context.require().tenant.featureFlags.chat === false) return;
        const manager = this.context.require().manager;
        const sender = await manager.getRepository(Users).findOneBy({ id: hc.sender_user_id });
        const member = await manager
          .getRepository(ChatMember)
          .findOneBy({ chat_id: hc.chat_id, user_id: hc.sender_user_id, left_at: IsNull() });
        if (!sender || !member) return;
        await runTenantSavepoint(() => this.chatsService.sendSystemMessage(hc.chat_id, hc.sender_user_id, message));
      } else await this.chatsService.sendSystemMessage(hc.chat_id, hc.sender_user_id, message);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
      this.logger.error(`Не удалось отправить алерт для #${hc.id}: ${errorMessage}`);
    }
  }

  private bulletItem(label: string, value: string) {
    return {
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: label },
            { type: 'text', text: value },
          ],
        },
      ],
    };
  }
}
