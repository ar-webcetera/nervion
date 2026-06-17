import { PartialType } from '@nestjs/swagger';
import { CreateMailAccountDto } from './create-mail-account.dto';

export class UpdateMailAccountDto extends PartialType(CreateMailAccountDto) {}
