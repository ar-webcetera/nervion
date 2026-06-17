import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWikiPageDto {
  @IsString({ message: 'Название страницы должно быть строкой' })
  @Length(0, 80, { message: 'Название должно быть меньше 80 символов' })
  @ApiProperty({
    description: 'Название страницы',
    example: 'Название страницы',
    required: false,
  })
  name: string;

  @IsNumber({}, { message: 'ID проекта должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID проекта',
    example: 2,
    required: true,
  })
  project_id?: number;

  @IsOptional()
  @ApiProperty({
    isArray: true,
    description: 'ID родительской страницы',
    example: 1,
    required: false,
  })
  parent_page_id: number;

  @Transform(({ value }: { value: number | string }) => (value ? Number(value) : value))
  @IsNumber({}, { message: 'Приоритет должен быть числом' })
  @IsOptional()
  @ApiProperty({
    description: 'Приоритет кратно 100',
    example: 100,
    required: false,
  })
  priority?: number;
}
