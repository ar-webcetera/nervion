import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { TenantDescriptor } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

export interface TenantMailConfiguration {
  tenantId: string;
  /** Operator confirms DNS ownership before installing this server-only record. */
  domainOwnershipVerified: true;
  domains: string[];
  notificationAccount: string;
  taskAliasAccount?: string;
  accessKeyId: string;
  secretAccessKey: string;
  configurationSet?: string;
  webhookRoutingKey: string;
  webhookSecret: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function parseTenantMailConfigurations(raw: string): TenantMailConfiguration[] {
  let entries: TenantMailConfiguration[];
  try {
    entries = JSON.parse(raw) as TenantMailConfiguration[];
  } catch {
    throw new Error('MAILBOX_TENANTS_JSON must contain valid JSON');
  }
  if (!Array.isArray(entries)) throw new Error('MAILBOX_TENANTS_JSON must be an array');
  const tenants = new Set<string>();
  const domains = new Set<string>();
  const routes = new Set<string>();
  for (const item of entries) {
    if (
      !item ||
      !UUID.test(item.tenantId) ||
      tenants.has(item.tenantId) ||
      item.domainOwnershipVerified !== true ||
      !Array.isArray(item.domains) ||
      !item.domains.length ||
      !UUID.test(item.webhookRoutingKey) ||
      routes.has(item.webhookRoutingKey) ||
      typeof item.webhookSecret !== 'string' ||
      item.webhookSecret.length < 32 ||
      typeof item.accessKeyId !== 'string' ||
      !item.accessKeyId.trim() ||
      typeof item.secretAccessKey !== 'string' ||
      !item.secretAccessKey.trim() ||
      (item.configurationSet !== undefined &&
        (typeof item.configurationSet !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.configurationSet)))
    ) {
      throw new Error('Invalid or duplicate tenant mail configuration');
    }
    for (const domain of item.domains) {
      if (typeof domain !== 'string' || !DOMAIN.test(domain) || domains.has(domain))
        throw new Error('Mail domains must be valid, lowercase and globally unique');
      domains.add(domain);
    }
    const ownsAddress = (address: string) =>
      typeof address === 'string' && /^[^\s@<>]+@[^\s@<>]+$/.test(address) && item.domains.includes(address.split('@')[1]);
    if (!ownsAddress(item.notificationAccount) || (item.taskAliasAccount !== undefined && !ownsAddress(item.taskAliasAccount))) {
      throw new Error('Configured mail accounts must belong to verified tenant domains');
    }
    tenants.add(item.tenantId);
    routes.add(item.webhookRoutingKey);
  }
  return entries;
}

@Injectable()
export class TenantMailConfigService {
  private readonly entries: TenantMailConfiguration[];

  constructor(
    private readonly config: ConfigService,
    private readonly context: TenantContextService,
    private readonly platform: PlatformService,
  ) {
    this.entries = this.isEnabled() ? parseTenantMailConfigurations(config.get<string>('MAILBOX_TENANTS_JSON') || '[]') : [];
  }

  isEnabled(): boolean {
    return this.config.get<string>('TENANCY_ENABLED') === 'true';
  }

  current(): TenantMailConfiguration {
    const { tenant } = this.context.require();
    if (tenant.featureFlags.mail !== true) throw new ForbiddenException('Почта отключена для пространства');
    const configuration = this.entries.find((item) => item.tenantId === tenant.id);
    if (!configuration) throw new ServiceUnavailableException('Почта пространства не настроена');
    return configuration;
  }

  assertSender(address: string): void {
    if (!this.isEnabled()) return;
    if (!this.current().domains.includes(address.trim().toLowerCase().split('@')[1])) {
      throw new ForbiddenException('Адрес не относится к подтвержденным почтовым доменам пространства');
    }
    if (this.context.require().tenant.readOnly) throw new ForbiddenException('Пространство доступно только для чтения');
  }

  async resolveRecipient(address: string): Promise<TenantDescriptor | null> {
    const domain = address.toLowerCase().split('@')[1];
    const configuration = this.entries.find((item) => item.domains.includes(domain));
    if (!configuration) return null;
    const tenant = await this.platform.getTenant(configuration.tenantId);
    if (tenant.readOnly) throw new ServiceUnavailableException('Пространство временно недоступно для входящей почты');
    if (tenant.featureFlags.mail !== true) return null;
    return tenant;
  }

  async authenticateWebhook(routingKey: string, header: string | undefined): Promise<TenantDescriptor> {
    const configuration = this.entries.find((item) => item.webhookRoutingKey === routingKey);
    const token = /^Bearer\s+(.+)$/i.exec(header || '')?.[1] || '';
    const expected = Buffer.from(configuration?.webhookSecret || 'invalid-unconfigured-webhook-secret');
    const actual = Buffer.from(token);
    if (!configuration || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException('Неверный webhook');
    const tenant = await this.platform.getTenant(configuration.tenantId);
    if (tenant.featureFlags.mail !== true) throw new NotFoundException();
    if (tenant.readOnly) throw new ServiceUnavailableException('Пространство временно недоступно для событий почты');
    return tenant;
  }
}
