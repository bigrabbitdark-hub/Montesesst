export class ConfirmLinksGroupDto {
  suggested_name: string;
  employee_ids: string[];
}

export class ConfirmLinksDto {
  groups: ConfirmLinksGroupDto[];
}
