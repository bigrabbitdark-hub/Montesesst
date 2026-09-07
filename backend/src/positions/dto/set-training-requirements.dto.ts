import { IsArray, IsIn } from 'class-validator';
import { TRAINING_TYPES } from '../../cipa/trainings.service';

export class SetTrainingRequirementsDto {
  @IsArray()
  @IsIn(TRAINING_TYPES, { each: true })
  tipos: string[];
}
