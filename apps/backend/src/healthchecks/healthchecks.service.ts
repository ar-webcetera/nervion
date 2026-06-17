import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import * as http from 'http';
import { HealthCheck, HealthCheckStatus } from './entities/healthcheck.entity';
import { CreateHealthCheckDto } from './dto/create-healthcheck.dto';
import { UpdateHealthCheckDto } from './dto/update-healthcheck.dto';
import { ChatsService } from '../chats/chats.service';

@Injectable()
export class HealthchecksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthchecksService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();

  constructor(
    @InjectRepository(HealthCheck)
    private readonly healthcheckRepository: Repository<HealthCheck>,
    private readonly chatsService: ChatsService,
  ) {}

  async onModuleInit(): Promise<void> {
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
    return this.healthcheckRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<HealthCheck> {
    const hc = await this.healthcheckRepository.findOneBy({ id });
    if (!hc) throw new Error(`Healthcheck #${id} не найден`);
    return hc;
  }

  async create(dto: CreateHealthCheckDto): Promise<HealthCheck> {
    const hc = this.healthcheckRepository.create(dto);
    const saved = await this.healthcheckRepository.save(hc);
    if (saved.is_active) {
      this.startTimer(saved);
    }
    return saved;
  }

  async update(id: number, dto: UpdateHealthCheckDto): Promise<HealthCheck> {
    const hc = await this.findOne(id);
    this.stopTimer(id);

    Object.assign(hc, dto);
    const saved = await this.healthcheckRepository.save(hc);

    if (saved.is_active) {
      this.startTimer(saved);
    }
    return saved;
  }

  async remove(id: number): Promise<void> {
    this.stopTimer(id);
    await this.healthcheckRepository.delete(id);
  }

  async toggle(id: number): Promise<HealthCheck> {
    const hc = await this.findOne(id);
    return this.update(id, { is_active: !hc.is_active });
  }

  private startTimer(hc: HealthCheck): void {
    this.stopTimer(hc.id);
    const timer = setInterval(() => {
      this.runCheck(hc.id).catch((err: unknown) => {
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
    } catch (err: unknown) {
      newStatus = HealthCheckStatus.FAIL;
      error = err instanceof Error ? err.message : 'Неизвестная ошибка';
    }

    hc.last_status = newStatus;
    hc.last_checked_at = new Date();
    hc.last_error = error;
    await this.healthcheckRepository.save(hc);

    this.logger.log(`[#${hc.id}] ${hc.name} → ${newStatus}${error ? ` (${error})` : ''}`);

    if (newStatus === HealthCheckStatus.FAIL && prevStatus !== HealthCheckStatus.FAIL) {
      await this.sendAlert(hc, error ?? 'Неизвестная ошибка', false);
    } else if (newStatus === HealthCheckStatus.OK && prevStatus === HealthCheckStatus.FAIL) {
      await this.sendAlert(hc, '', true);
    }
  }

  private httpGet(url: string, timeoutSeconds: number): Promise<number> {
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

  private async sendAlert(hc: HealthCheck, reason: string, isRecovery: boolean): Promise<void> {
    const emoji = isRecovery ? '🟢' : '🔴';
    const title = isRecovery ? `${emoji} Healthcheck — Восстановлен` : `${emoji} Healthcheck — Недоступен`;

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
      await this.chatsService.sendSystemMessage(hc.chat_id, hc.sender_user_id, message);
    } catch (err: unknown) {
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
