import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ParseTextDto {
  @ApiPropertyOptional({
    example: 'Нужно сверстать новую кнопку в шапке сайта',
    description: 'Текст для парсинга в задачу',
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    example: 'Сделай описание короче и добавь критерий по производительности',
    description: 'Дополнительная инструкция по редактированию',
  })
  @IsOptional()
  @IsString()
  instruction?: string;
}
