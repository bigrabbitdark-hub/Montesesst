import { IsIn } from 'class-validator';

export class UpdateSubscriptionStatusDto {
  @IsIn(['authorized', 'paused', 'cancelled'])
  status: 'authorized' | 'paused' | 'cancelled';
}
