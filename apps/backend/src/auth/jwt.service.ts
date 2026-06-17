import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './types/jwt-payload';
import { getAuthTokenTtlSeconds } from './utils/auth-session';
import { resolveJwtSecret } from './utils/jwt-secret';

@Injectable()
export class JwtAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateToken(payload: JwtPayload): string {
    const secret = resolveJwtSecret(this.configService);
    return this.jwtService.sign(payload, { secret, expiresIn: getAuthTokenTtlSeconds(this.configService) });
  }

  verifyToken(token: string): JwtPayload {
    const secret = resolveJwtSecret(this.configService);
    return this.jwtService.verify<JwtPayload>(token, { secret });
  }
}
