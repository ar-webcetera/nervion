import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateWikiPageDto {
  @IsString({ message: 'Название страницы должно быть строкой' })
  @Length(0, 80, { message: 'Название должно быть меньше 80 символов' })
  @ApiProperty({
    description: 'Название страницы',
    example: 'Название страницы',
    required: false,
  })
  @IsOptional()
  name: string;

  @ApiPropertyOptional({
    description: 'ID родительской страницы (может быть null)',
    example: null,
    nullable: true,
  })
  @ValidateIf((o) => o.parent_page_id !== null)
  @IsOptional()
  @IsNumber(
    {},
    {
      message: 'parent_page_id должен быть числом или null',
    },
  )
  parent_page_id: number | null;

  @Transform(({ value }: { value: number | string }) => (value ? Number(value) : value))
  @IsNumber({}, { message: 'Приоритет должен быть числом' })
  @IsOptional()
  @ApiProperty({
    description: 'Приоритет кратно 100',
    example: 100,
    required: false,
  })
  priority?: number;

  @IsObject({ message: 'Описание страницы должно быть объектом с JSON-контентом TipTap' })
  @ApiProperty({
    description: 'Описание страницы в формате JSON для TipTap-редактора',
    type: 'object',
    example: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Тут ваше описание страницы...' }],
        },
      ],
    },
    required: false,
  })
  @IsOptional()
  description: Record<string, any>;
}
