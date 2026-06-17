import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnloadFileDto {
  @ApiProperty({
    description: 'Путь до папки с файлами',
    type: String,
    example: 'task-files/123/',
  })
  @IsString()
  prefix: string;
}
