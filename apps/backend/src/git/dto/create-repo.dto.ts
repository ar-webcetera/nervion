import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRepoDto {
  @ApiProperty({ description: 'Название репозитория', example: 'my-repo' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Абсолютный путь к git-каталогу (bare-репа или .../.git)',
    example: '/var/git/my-repo.git',
  })
  @IsString()
  @MinLength(1)
  gitdir: string;

  @ApiProperty({ description: 'Ветка по умолчанию (пусто — определится автоматически)', required: false })
  @IsOptional()
  @IsString()
  defaultBranch?: string;

  @ApiProperty({ description: 'ID проекта-владельца', required: false })
  @IsOptional()
  @IsInt()
  projectId?: number;
}
