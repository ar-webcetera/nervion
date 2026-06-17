import { IsNumber, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TiptapDoc } from '../../common/types/tiptap';

export class CreateCommentDto {
  @IsNumber({}, { message: 'ID задачи должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID задачи',
    example: 4,
    required: false,
  })
  task_id?: number;

  @IsNumber({}, { message: 'ID родительского комментария должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID родительского комментария (для треда)',
    example: 3,
    required: false,
  })
  comment_id?: number;

  @IsOptional()
  @ApiProperty({
    description: 'ID автора комментария',
    example: 6,
    required: false,
  })
  author_id: number;

  @IsObject({ message: 'Содержание комментария должно быть объектом с JSON-контентом TipTap' })
  @ApiProperty({
    description: 'Содержние комментария в формате JSON для TipTap-редактора',
    type: 'object',
    example: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Тут ваше описание задачи...' }],
        },
      ],
    },
    required: false,
  })
  message: TiptapDoc;
}
