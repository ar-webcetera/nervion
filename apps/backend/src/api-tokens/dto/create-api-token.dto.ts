import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiTokenDto {
  @IsString()
  @ApiProperty({ description: 'Название токена', example: 'CI/CD pipeline' })
  name: string;

  @IsOptional()
  @ApiProperty({ description: 'Дата истечения (ISO строка)', example: '2027-01-01T00:00:00.000Z', required: false })
  expires_at?: string;
}
