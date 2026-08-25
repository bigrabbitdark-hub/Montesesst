export type ChecklistBlock = 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';

export interface ChecklistItemDefinition {
  block: ChecklistBlock;
  item_key: string;
  item_label: string;
}

// Itens fixos do modelo de referência real (docs/reference/modelos-relatorios-sst.md,
// seção 2, blocos 2/3/5/6). Única fonte de verdade — usada tanto pra semear
// uma inspeção nova quanto pelos rótulos que a API devolve.
export const CHECKLIST_ITEMS: ChecklistItemDefinition[] = [
  { block: 'documentacao', item_key: 'fichas_epi', item_label: 'Fichas de EPI em dia' },
  { block: 'documentacao', item_key: 'ordem_servico', item_label: 'Ordem de Serviço' },
  { block: 'documentacao', item_key: 'validade_ca', item_label: 'Validade do CA' },
  { block: 'documentacao', item_key: 'aso_em_dia', item_label: 'ASO em dia' },
  { block: 'epis', item_key: 'uso_adequado', item_label: 'Uso adequado' },
  { block: 'epis', item_key: 'estado_conservacao', item_label: 'Estado de conservação' },
  { block: 'epis', item_key: 'compatibilidade_risco', item_label: 'Compatibilidade com risco do setor' },
  { block: 'epis', item_key: 'reposicao_danificados', item_label: 'Reposição de danificados' },
  { block: 'instalacoes', item_key: 'luzes_emergencia', item_label: 'Luzes de emergência' },
  { block: 'instalacoes', item_key: 'sinalizacao', item_label: 'Sinalização' },
  { block: 'instalacoes', item_key: 'extintores', item_label: 'Extintores (validade e pressão)' },
  { block: 'instalacoes', item_key: 'rotas_fuga', item_label: 'Rotas de fuga' },
  { block: 'maquinas', item_key: 'protecoes', item_label: 'Proteções' },
  { block: 'maquinas', item_key: 'loto', item_label: 'LOTO (bloqueio/travamento)' },
  { block: 'maquinas', item_key: 'distancia_seguranca', item_label: 'Distância de segurança' },
  { block: 'maquinas', item_key: 'treinamento_operador', item_label: 'Treinamento do operador' },
];
