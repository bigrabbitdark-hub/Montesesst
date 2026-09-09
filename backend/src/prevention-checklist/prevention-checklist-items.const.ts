export interface PreventionChecklistItemDefinition {
  item_key: string;
  item_label: string;
}

// Itens fixos do checklist de prevenção contra incêndio (spec, Seção 3).
// Única fonte de verdade — usada tanto pra semear um checklist novo
// quanto pelos rótulos que a API devolve. Mesmo padrão de
// checklist-items.const.ts (Inspeções), sem blocos (decisão do
// fundador — lista plana, não agrupada).
export const PREVENTION_CHECKLIST_ITEMS: PreventionChecklistItemDefinition[] = [
  { item_key: 'extintores_acessiveis', item_label: 'Extintores acessíveis' },
  { item_key: 'extintores_sinalizados', item_label: 'Extintores sinalizados' },
  { item_key: 'sem_obstrucao', item_label: 'Sem obstrução' },
  { item_key: 'lacre_integro', item_label: 'Lacre íntegro' },
  { item_key: 'manometro_adequado', item_label: 'Manômetro em condição adequada, quando aplicável' },
  { item_key: 'mangueiras_acessiveis', item_label: 'Mangueiras acessíveis' },
  { item_key: 'saidas_desobstruidas', item_label: 'Saídas desobstruídas' },
  { item_key: 'sinalizacao_visivel', item_label: 'Sinalização visível' },
  { item_key: 'iluminacao_emergencia', item_label: 'Iluminação de emergência' },
  { item_key: 'alarmes', item_label: 'Alarmes' },
  { item_key: 'portas_emergencia', item_label: 'Portas de emergência' },
  { item_key: 'rotas_fuga', item_label: 'Rotas de fuga' },
  { item_key: 'ponto_encontro', item_label: 'Ponto de encontro' },
  { item_key: 'brigadistas_disponiveis', item_label: 'Brigadistas disponíveis' },
];
