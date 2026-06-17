import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class FindCommentsByFilterDto {
  @IsNumber({}, { message: 'ID задачи должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID задачи',
    example: 4,
    required: false,
  })
  task_id?: number;

  @IsEnum(SortOrder, { message: `sort должен быть либо ${SortOrder.ASC}, либо ${SortOrder.DESC}` })
  @IsOptional()
  @ApiProperty({
    description: `Порядок сортировки (${SortOrder.ASC} или ${SortOrder.DESC})`,
    enum: SortOrder,
    example: SortOrder.ASC,
    required: false,
  })
  sort?: SortOrder;
}
