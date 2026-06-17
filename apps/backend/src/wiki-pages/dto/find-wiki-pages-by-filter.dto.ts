import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FindWikiPagesByFilterDto {
  @IsNumber({}, { message: 'ID проекта должно быть числом' })
  @IsOptional()
  @ApiProperty({
    description: 'ID проекта',
    example: 1,
    required: false,
  })
  project_id?: number;
}
