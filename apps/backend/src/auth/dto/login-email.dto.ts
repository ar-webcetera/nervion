import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}
