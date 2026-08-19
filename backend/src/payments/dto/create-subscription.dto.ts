import { IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  plan_id: string;
}
