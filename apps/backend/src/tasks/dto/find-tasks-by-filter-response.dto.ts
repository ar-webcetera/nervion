import { ApiProperty } from '@nestjs/swagger';

class Assignee {
  @ApiProperty({ example: 'e.sergeev' })
  username: string;

  @ApiProperty({ example: 'Сергеев Егор' })
  name: string;
}

export class TaskResponse {
  @ApiProperty({ example: '1481' })
  id: string;

  @ApiProperty({ example: 'Написать выгрузку количества заданий по темам' })
  title: string;

  @ApiProperty({ example: '190' })
  iid: string;

  @ApiProperty({ example: 6 })
  projectId: number;

  @ApiProperty({ example: 'Amansultan' })
  groupName: string;

  @ApiProperty({ example: '3' })
  groupId: string;

  @ApiProperty({ example: ['На ревью'] })
  labels: string[];

  @ApiProperty({ example: 'https://tracker.example.com/tasks/190' })
  webUrl: string;

  @ApiProperty({ type: [Assignee] })
  assignees: {
    nodes: Assignee[];
  };
}

export class FindTasksByFilterResponse {
  @ApiProperty({ type: [TaskResponse] })
  tasks: TaskResponse[];
}
