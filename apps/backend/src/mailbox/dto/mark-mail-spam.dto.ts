import { MailSpamRuleScope } from '@tracker/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class MarkMailSpamDto {
  @ApiProperty({ description: 'Блокировать отправителя или весь домен', enum: MailSpamRuleScope })
  @IsEnum(MailSpamRuleScope)
  scope: MailSpamRuleScope;
}
