import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ParseTextDto {
  @ApiProperty({
    example: 'Нужно сверстать новую кнопку в шапке сайта',
    description: 'Текст для парсинга в задачу',
  })
  @IsString()
  declare text: string;

  @ApiPropertyOptional({
    example: 'Сделай описание короче и добавь критерий по производительности',
    description: 'Дополнительная инструкция по редактированию',
  })
  @IsOptional()
  @IsString()
  instruction?: string;
}
