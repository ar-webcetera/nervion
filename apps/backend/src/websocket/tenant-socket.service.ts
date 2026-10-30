import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Socket } from 'socket.io';
import type { Handshake } from 'socket.io/dist/socket-types';
import { JwtAuthService } from '../auth/jwt.service';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { normalizeTenantHost, resolveTenantHost } from '../tenancy/tenant-host';
import { Users } from '../users/entities/users.entity';

export interface TenantSocketIdentity {
  tenantId: string;
  userId: number;
  role: string;
}

@Injectable()
export class TenantSocketService {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly platform: PlatformService,
    private readonly database: TenantDatabaseService,
    private readonly context: TenantContextService,
    private readonly db: DataSource,
  ) {}

  room(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  async authenticate(handshake: Pick<Handshake, 'headers'>): Promise<TenantSocketIdentity> {
    return this.authenticateForHost(handshake, this.context.isEnabled() ? resolveTenantHost(handshake.headers) : undefined);
  }

  // The hostname is verified once at upgrade, then pinned in server-owned
  // Socket.IO data. Session and membership are still checked on every call.
  // A short-lived ingress signature must not expire an established connection.
  async authenticateConnected(client: Pick<Socket, 'data' | 'handshake'>): Promise<TenantSocketIdentity> {
    const host = client.data.nervionHostname as string | undefined;
    if (this.context.isEnabled() && (typeof host !== 'string' || normalizeTenantHost(host) !== host)) {
      throw new UnauthorizedException();
    }
    return this.authenticateForHost(client.handshake, host);
  }

  private async authenticateForHost(handshake: Pick<Handshake, 'headers'>, host?: string): Promise<TenantSocketIdentity> {
    const raw = handshake.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('authToken='))
      ?.slice(10);
    if (!raw) throw new UnauthorizedException();
    const payload = this.jwt.verifyToken(decodeURIComponent(raw));
    const userId = payload.id ?? payload.userId;
    if (!userId || !Number.isSafeInteger(userId)) throw new UnauthorizedException();
    if (!this.context.isEnabled()) {
      const user = await this.db.getRepository(Users).findOneBy({ id: userId });
      if (!user) throw new UnauthorizedException();
      return { tenantId: 'legacy', userId, role: user.role };
    }
    if (!host) throw new UnauthorizedException();
    const origin = handshake.headers.origin;
    if (!origin) throw new UnauthorizedException();
    let source: URL;
    try {
      source = new URL(origin);
    } catch {
      throw new UnauthorizedException();
    }
    if (
      source.hostname !== host ||
      !['http:', 'https:'].includes(source.protocol) ||
      (process.env.NODE_ENV === 'production' && (source.protocol !== 'https:' || !!source.port))
    )
      throw new UnauthorizedException();
    const tenant = await this.platform.resolveTenant(host);
    const membership = await this.platform.assertSession(tenant.id, userId, payload);
    return this.database.run(
      tenant,
      async () => {
        const user = await this.db.getRepository(Users).findOneBy({ id: userId });
        if (!user || String(user.role) !== membership.role) throw new UnauthorizedException();
        return { tenantId: tenant.id, userId, role: membership.role };
      },
      { readOnly: true },
    );
  }

  async connect(client: Socket): Promise<void> {
    const host = this.context.isEnabled() ? resolveTenantHost(client.handshake.headers) : undefined;
    const identity = await this.authenticateForHost(client.handshake, host);
    client.data.nervion = identity;
    client.data.nervionHostname = host;
    await client.join(this.room(identity.tenantId));
  }

  identity(client: Pick<Socket, 'data'>): TenantSocketIdentity | undefined {
    const value = client.data.nervion as TenantSocketIdentity | undefined;
    return value && typeof value.tenantId === 'string' && Number.isInteger(value.userId) ? value : undefined;
  }
}
