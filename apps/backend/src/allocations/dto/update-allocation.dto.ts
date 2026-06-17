import { PartialType } from '@nestjs/mapped-types';
import { CreateAllocationDto } from './create-allocation.dto';

export class UpdateAllocationDto extends PartialType(CreateAllocationDto) {}
