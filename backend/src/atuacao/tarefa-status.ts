export const TAREFA_STATUS = [
  'pending', 'in_progress', 'blocked', 'awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy',
  'completed', 'cancelled',
] as const;
export type TarefaStatus = (typeof TAREFA_STATUS)[number];
export const TAREFA_PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'] as const;
export const ABERTAS: readonly TarefaStatus[] = [
  'pending', 'in_progress', 'blocked', 'awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy',
];
// Estados de espera (D2): valor técnico do banco -> chave devolvida em resumo/painel.
export const ESPERA_POR_STATUS = {
  awaiting_client: 'aguardando_cliente',
  awaiting_review: 'aguardando_avaliacao',
  awaiting_execution: 'aguardando_execucao',
  awaiting_efficacy: 'aguardando_eficacia',
} as const satisfies Partial<Record<TarefaStatus, string>>;
export const ESPERA: readonly TarefaStatus[] = Object.keys(ESPERA_POR_STATUS) as TarefaStatus[];

// Regra: entre estados ABERTOS a troca é livre (qualquer um para qualquer outro, exceto o mesmo estado).
// Saídas para o fim: concluir só a partir de in_progress ou de um estado de espera (mantém a regra original:
// pending e blocked não concluem direto); cancelar a partir de qualquer aberto. completed e cancelled são finais
// e só reabrem como antes (completed -> in_progress; cancelled -> pending); nunca vão um ao outro.
const FINAIS: readonly TarefaStatus[] = ['completed', 'cancelled'];
const PODE_CONCLUIR: readonly TarefaStatus[] = ['in_progress', ...ESPERA];

const TRANSICOES = Object.fromEntries([
  ...ABERTAS.map((de) => [de, [
    ...ABERTAS.filter((p) => p !== de),
    ...(PODE_CONCLUIR.includes(de) ? ['completed'] : []),
    'cancelled',
  ]]),
  ['completed', ['in_progress']],
  ['cancelled', ['pending']],
]) as Record<TarefaStatus, readonly TarefaStatus[]>;
export const STATUS_FINAIS = FINAIS;

export function transicaoPermitida(de: TarefaStatus, para: TarefaStatus): boolean {
  return TRANSICOES[de].includes(para);
}

// Bloquear e cancelar exigem justificativa registrada no histórico.
export function exigeNota(para: TarefaStatus): boolean {
  return para === 'blocked' || para === 'cancelled';
}
