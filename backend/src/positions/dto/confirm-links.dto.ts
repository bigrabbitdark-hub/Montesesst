import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class ConfirmLinksGroupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  suggested_name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  employee_ids: string[];
}

export class ConfirmLinksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmLinksGroupDto)
  groups: ConfirmLinksGroupDto[];
}
