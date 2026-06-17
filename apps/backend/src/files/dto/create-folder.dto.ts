import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFolderDto {
  @ApiProperty({
    description: 'Путь до родительской папки',
    type: String,
    example: 'tracker-project-wiki/1/',
  })
  @IsString()
  prefix: string;

  @ApiProperty({
    description: 'Название новой папки',
    type: String,
    example: 'designs',
  })
  @IsString()
  folderName: string;
}
