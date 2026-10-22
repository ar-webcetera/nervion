import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import type {
  SaveTaskStage,
  CreateTaskStage,
  ReorderTaskStages,
  DeleteTaskStage,
  ApplyTaskStages,
  TaskStageDraft,
  RemovedTaskStage,
} from '@tracker/contracts';

export class SaveTaskStageDto implements SaveTaskStage {
  @Transform(({ value }: { value: string }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  title: string;
}

export class CreateTaskStageDto extends SaveTaskStageDto implements CreateTaskStage {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  afterStageId?: string;
}

export class ReorderTaskStagesDto implements ReorderTaskStages {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  ids: string[];
}

export class DeleteTaskStageDto implements DeleteTaskStage {
  @IsOptional()
  @IsString()
  targetStatus?: string;
}

export class TaskStageDraftDto extends SaveTaskStageDto implements TaskStageDraft {
  @IsString()
  @Length(1, 100)
  id: string;
}

export class RemovedTaskStageDto extends DeleteTaskStageDto implements RemovedTaskStage {
  @IsString()
  @Length(1, 100)
  id: string;
}

export class ApplyTaskStagesDto implements ApplyTaskStages {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((stage: TaskStageDraftDto) => stage.id)
  @ValidateNested({ each: true })
  @Type(() => TaskStageDraftDto)
  originalStages: TaskStageDraftDto[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique((stage: TaskStageDraftDto) => stage.id)
  @ValidateNested({ each: true })
  @Type(() => TaskStageDraftDto)
  stages: TaskStageDraftDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((stage: RemovedTaskStageDto) => stage.id)
  @ValidateNested({ each: true })
  @Type(() => RemovedTaskStageDto)
  removedStages: RemovedTaskStageDto[];
}
