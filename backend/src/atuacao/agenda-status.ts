export const AGENDA_STATUS = ['agendado', 'concluido', 'cancelado'] as const;
export type AgendaStatus = (typeof AGENDA_STATUS)[number];
export const AGENDA_TIPOS = ['reuniao', 'visita', 'ligacao', 'outro'] as const;

// Só evento agendado muda de estado; concluído e cancelado são terminais.
export function transicaoAgendaPermitida(de: AgendaStatus, para: AgendaStatus): boolean {
  return de === 'agendado' && (para === 'concluido' || para === 'cancelado');
}

// Cancelar exige motivo registrado.
export function exigeNotaAgenda(para: AgendaStatus): boolean {
  return para === 'cancelado';
}
