import { ApiProperty } from '@nestjs/swagger';

class TiptapNode {
  @ApiProperty()
  type: string;

  @ApiProperty({ required: false })
  content?: TiptapNode[];

  @ApiProperty({ required: false })
  text?: string;
}

class TiptapDescription {
  @ApiProperty({ example: 'doc' })
  type: string;

  @ApiProperty({ type: [TiptapNode] })
  content: TiptapNode[];
}

export class ParsedTaskDto {
  @ApiProperty({ example: 'Сверстать кнопку в шапке' })
  title: string;

  @ApiProperty()
  description: TiptapDescription;
}
