import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEnum, IsNumber, IsOptional, ValidateIf } from 'class-validator';
import { TIMELOG_STATUSES } from '../../common/enums/statuses.enum';
import { Type } from 'class-transformer';

export class GetTimelogByFilterDto {
  @ValidateIf((o: { status: TIMELOG_STATUSES }) => Array.isArray(o.status))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(TIMELOG_STATUSES, { each: true })
  @Type(() => String)
  @ApiProperty({
    description: 'Статус таймтрека',
    example: 1,
  })
  @IsOptional()
  status: TIMELOG_STATUSES | TIMELOG_STATUSES[];

  @ApiProperty({
    description: 'ID автора',
    example: 1,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateIf((o: { author_id: number }) => o.author_id !== null)
  @Type(() => Number)
  @IsNumber({}, { message: 'ID автора должен быть числом' })
  author_id: number | null;
}
