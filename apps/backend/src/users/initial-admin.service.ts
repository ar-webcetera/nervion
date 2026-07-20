import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { ROLES } from '../common/enums/roles.enum';
import { Users } from './entities/users.entity';

@Injectable()
export class InitialAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialAdminService.name);

  constructor(
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.userRepository.count()) > 0) {
      return;
    }

    const email = this.configService.get<string>('INITIAL_ADMIN_EMAIL')?.trim();
    const password = this.configService.get<string>('INITIAL_ADMIN_PASSWORD');

    if (!email || !password) {
      this.logger.warn('Пользователей нет, но INITIAL_ADMIN_EMAIL или INITIAL_ADMIN_PASSWORD не заданы.');
      return;
    }

    if (password.length < 8) {
      throw new Error('INITIAL_ADMIN_PASSWORD должен содержать минимум 8 символов.');
    }

    const admin = this.userRepository.create({
      email,
      first_name: this.configService.get<string>('INITIAL_ADMIN_FIRST_NAME')?.trim() || 'Администратор',
      last_name: this.configService.get<string>('INITIAL_ADMIN_LAST_NAME')?.trim() || 'Нервион',
      role: ROLES.admin,
      hashed_password: this.authService.hashPassword(password),
    });

    await this.userRepository.save(admin);
    this.logger.log(`Создан первый администратор: ${email}`);
  }
}
