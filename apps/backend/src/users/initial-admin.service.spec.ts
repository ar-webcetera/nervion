import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../auth/auth.service';
import { ROLES } from '../common/enums/roles.enum';
import { Users } from './entities/users.entity';
import { InitialAdminService } from './initial-admin.service';

describe('InitialAdminService', () => {
  const repository = {
    count: jest.fn<Promise<number>, []>(),
    create: jest.fn<Users, [Partial<Users>]>(),
    save: jest.fn<Promise<Users>, [Users]>(),
  };
  const authService = {
    hashPassword: jest.fn<string, [string]>(),
  };
  const values: Record<string, string> = {
    INITIAL_ADMIN_EMAIL: 'admin@nervion.local',
    INITIAL_ADMIN_PASSWORD: 'secure-password',
    INITIAL_ADMIN_FIRST_NAME: 'Администратор',
    INITIAL_ADMIN_LAST_NAME: 'Нервион',
  };
  const configService = {
    get: jest.fn(<T>(key: string): T | undefined => values[key] as T | undefined),
  };

  let service: InitialAdminService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InitialAdminService,
        { provide: getRepositoryToken(Users), useValue: repository },
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(InitialAdminService);

    jest.clearAllMocks();
    repository.count.mockResolvedValue(0);
    authService.hashPassword.mockReturnValue('hashed-password');
    const admin = { id: 1, email: values.INITIAL_ADMIN_EMAIL, role: ROLES.admin } as Users;
    repository.create.mockReturnValue(admin);
    repository.save.mockResolvedValue(admin);
  });

  it('создаёт администратора при пустой таблице users', async () => {
    await service.onApplicationBootstrap();

    expect(authService.hashPassword).toHaveBeenCalledWith(values.INITIAL_ADMIN_PASSWORD);
    expect(repository.create).toHaveBeenCalledWith({
      email: values.INITIAL_ADMIN_EMAIL,
      first_name: values.INITIAL_ADMIN_FIRST_NAME,
      last_name: values.INITIAL_ADMIN_LAST_NAME,
      role: ROLES.admin,
      hashed_password: 'hashed-password',
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('не меняет пользователей при непустой таблице', async () => {
    repository.count.mockResolvedValue(1);

    await service.onApplicationBootstrap();

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
