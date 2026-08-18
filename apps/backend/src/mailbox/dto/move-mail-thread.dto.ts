import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MailSystemFolder } from '@tracker/contracts';

export class MoveMailThreadDto {
  @ApiPropertyOptional({ description: 'Системная папка', enum: MailSystemFolder })
  @IsOptional()
  @IsEnum(MailSystemFolder)
  system_folder?: MailSystemFolder;

  @ApiPropertyOptional({ description: 'ID пользовательской папки', example: 3 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  custom_folder_id?: number;
}
