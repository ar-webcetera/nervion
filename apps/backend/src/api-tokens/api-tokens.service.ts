import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { ApiToken } from './entities/api-token.entity';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class ApiTokensService {
  constructor(
    @InjectRepository(ApiToken)
    private readonly apiTokenRepository: Repository<ApiToken>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    userId: number,
    dto: CreateApiTokenDto,
    currentUser: AuthenticatedUser,
  ): Promise<{ token: string; record: ApiToken }> {
    const raw = 'wct_' + randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');

    const record = this.apiTokenRepository.create({
      name: dto.name,
      token_hash: hash,
      user_id: userId,
      expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
    });

    await this.apiTokenRepository.save(record);
    void this.auditLogsService.record({
      actionType: AuditActionType.API_TOKEN_CREATED,
      entityType: AuditEntityType.API_TOKEN,
      entityId: record.id,
      entityLabel: record.name,
      actor: currentUser,
      summary: `Создан API-токен "${record.name}"`,
      afterPayload: {
        name: record.name,
        expires_at: record.expires_at?.toISOString() ?? null,
      },
    });
    return { token: raw, record };
  }

  findAllByUser(userId: number): Promise<ApiToken[]> {
    return this.apiTokenRepository.find({
      where: { user_id: userId },
      select: ['id', 'name', 'user_id', 'last_used_at', 'expires_at', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async remove(id: number, userId: number, currentUser: AuthenticatedUser): Promise<void> {
    const record = await this.apiTokenRepository.findOne({ where: { id, user_id: userId } });
    await this.apiTokenRepository.delete({ id, user_id: userId });

    if (record) {
      void this.auditLogsService.record({
        actionType: AuditActionType.API_TOKEN_DELETED,
        entityType: AuditEntityType.API_TOKEN,
        entityId: record.id,
        entityLabel: record.name,
        actor: currentUser,
        summary: `Удален API-токен "${record.name}"`,
        beforePayload: {
          name: record.name,
          expires_at: record.expires_at?.toISOString() ?? null,
          last_used_at: record.last_used_at?.toISOString() ?? null,
        },
      });
    }
  }

  async findByToken(raw: string): Promise<ApiToken | null> {
    const hash = createHash('sha256').update(raw).digest('hex');
    const token = await this.apiTokenRepository.findOne({
      where: { token_hash: hash },
      relations: ['user'],
    });

    if (!token) return null;
    if (token.expires_at && token.expires_at < new Date()) return null;

    token.last_used_at = new Date();
    await this.apiTokenRepository.save(token);
    return token;
  }
}
