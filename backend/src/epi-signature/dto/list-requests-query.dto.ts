import { IsUUID } from 'class-validator';

export class ListRequestsQueryDto {
  @IsUUID() employee_id: string;
}
