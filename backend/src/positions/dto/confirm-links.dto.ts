export class ConfirmLinksGroupDto {
  // Um dos dois precisa vir preenchido — ver comentário em
  // PositionsService.confirmLinks sobre por que os dois formatos são
  // aceitos.
  name?: string;
  suggested_name?: string;
  employee_ids: string[];
}

export class ConfirmLinksDto {
  groups: ConfirmLinksGroupDto[];
}
