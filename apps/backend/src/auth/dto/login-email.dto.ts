import { IsNotEmpty, IsString } from 'class-validator';

export class LoginEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
