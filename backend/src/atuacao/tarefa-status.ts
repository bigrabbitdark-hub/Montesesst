export const TAREFA_STATUS = ['pending', 'in_progress', 'blocked', 'awaiting_review', 'completed', 'cancelled'] as const;
export type TarefaStatus = (typeof TAREFA_STATUS)[number];
export const TAREFA_PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'] as const;
export const ABERTAS: readonly TarefaStatus[] = ['pending', 'in_progress', 'blocked', 'awaiting_review'];

const TRANSICOES: Record<TarefaStatus, readonly TarefaStatus[]> = {
  pending: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'awaiting_review', 'completed', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  awaiting_review: ['in_progress', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['pending'],
};

export function transicaoPermitida(de: TarefaStatus, para: TarefaStatus): boolean {
  return TRANSICOES[de].includes(para);
}

// Bloquear e cancelar exigem justificativa registrada no histórico.
export function exigeNota(para: TarefaStatus): boolean {
  return para === 'blocked' || para === 'cancelled';
}
