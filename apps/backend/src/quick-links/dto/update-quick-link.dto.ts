import { PartialType } from '@nestjs/swagger';
import { CreateQuickLinkDto } from './create-quick-link.dto';

export class UpdateQuickLinkDto extends PartialType(CreateQuickLinkDto) {}
