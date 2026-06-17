import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranscribeAudioDto {
  @ApiProperty({
    description: 'URL аудиофайла в S3 или внутренний storage key',
    example: 'https://cdn.example.com/tracker-chat/uuid/voice/voice_123.webm',
  })
  @IsNotEmpty()
  @IsString()
  audioUrl: string;
}
