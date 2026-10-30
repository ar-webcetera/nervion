import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { GitConnectRequest } from '@tracker/contracts';

export class CreateRepoDto implements GitConnectRequest {
  @ApiProperty({ description: 'Название репозитория', example: 'my-repo' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Абсолютный путь к git-каталогу (bare-репа или .../.git)',
    example: '/var/git/my-repo.git',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  gitdir?: string;

  @ApiProperty({ description: 'HTTPS-адрес удаленного репозитория для SaaS', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  remoteUrl?: string;

  @ApiProperty({ description: 'Имя пользователя Git-провайдера для HTTPS', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  username?: string;

  @ApiProperty({ description: 'Токен только для чтения репозитория. Не возвращается через API', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  token?: string;

  @ApiProperty({ description: 'Ветка по умолчанию (пусто — определится автоматически)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultBranch?: string;

  @ApiProperty({ description: 'ID проекта-владельца', required: false })
  @IsOptional()
  @IsInt()
  projectId?: number;
}
