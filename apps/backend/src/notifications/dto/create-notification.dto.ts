import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateNotificationDto {
  @IsString({ message: 'Название уведомления должно быть строкой' })
  @ApiProperty({
    description: 'Название уведомления',
    example: 'Иван Иванов комментирует',
    required: true,
  })
  name: string;

  @IsString({ message: 'Текст сообщения должен быть строкой' })
  @ApiProperty({
    description: 'Текст сообщения уведомления',
    example: 'Необходимо собрать требования к задаче',
    required: true,
  })
  message: string;

  @IsNumber({}, { message: 'recipient_id должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'Идентификатор получателя уведомления',
    example: 22,
    required: false,
  })
  recipient_id: number;

  @IsOptional()
  @ApiProperty({
    description: 'Ссылка на источник',
    example: '/inbox?task-id=5',
    required: false,
  })
  link: string;

  @IsOptional()
  @ApiProperty({
    description: 'Уведомление прочитано',
    example: true,
    required: false,
  })
  is_read?: boolean;
}
