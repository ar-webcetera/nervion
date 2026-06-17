import { IsNumber, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProjectMemberDto {
  @IsNumber()
  id: number;

  @IsString()
  role: string;
}

export class UpdateProjectMembersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectMemberDto)
  members: ProjectMemberDto[];
}
