import { IsIn } from 'class-validator';

export class UpdateCorrectiveActionStatusDto {
  @IsIn(['pendente', 'resolvido'])
  status: string;
}
