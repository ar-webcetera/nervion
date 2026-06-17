import { ApiProperty } from '@nestjs/swagger';
import { PROJECT_STATUSES } from '../../common/enums/project-status.enum';
import { ProjectMemberDto } from './project-member.dto';
import type { JSONContent } from '@tiptap/core';

export class GetProjectsResponseDto {
  @ApiProperty({
    description: 'Название проекта',
    example: 'Amansultan',
  })
  name: string;

  @ApiProperty({
    description: 'Идентификатор проекта',
    example: 6,
  })
  id: number;

  @ApiProperty({
    description: 'Дата создания',
    example: '2025-07-18T09:55:24.540Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Дата обновления',
    example: '2025-07-18T09:55:24.540Z',
  })
  updatedAt: string;

  @ApiProperty({
    description: 'Статус проекта',
    enum: PROJECT_STATUSES,
    example: PROJECT_STATUSES.IN_PROGRESS,
  })
  status: PROJECT_STATUSES;

  @ApiProperty({
    description: 'Бюджет проекта',
    example: 0,
  })
  budget: number;

  @ApiProperty({
    description: 'Описание проекта',
    required: false,
  })
  description?: JSONContent;

  @ApiProperty({
    description: 'Часовая ставка',
    example: 0,
  })
  hourlyRate: number;

  @ApiProperty({
    description: 'Затраченный бюджет за месяц',
    example: 0,
  })
  spentBudget: number;

  @ApiProperty({
    description: 'Участники проекта',
    type: [ProjectMemberDto],
  })
  members: ProjectMemberDto[];
}
