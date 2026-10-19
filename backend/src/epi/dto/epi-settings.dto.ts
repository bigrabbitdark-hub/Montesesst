import { IsInt, Max, Min } from 'class-validator';

export class UpdateEpiSettingsDto {
  @IsInt() @Min(1) @Max(365) epi_alert_days: number;
}
