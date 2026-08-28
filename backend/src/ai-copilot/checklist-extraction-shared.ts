import { CHECKLIST_ITEMS } from '../inspections/checklist-items.const';
import { ChecklistItemSuggestion } from './field-report-extractor.interface';

// Compartilhado entre MiniMaxExtractorService e OpenRouterExtractorService —
// os dois falam o mesmo formato OpenAI-compatible de chat completions com
// tool calling, só endpoint/auth/nome de modelo mudam.
export const VALID_ITEM_KEYS = CHECKLIST_ITEMS.map((item) => item.item_key);
export const VALID_STATUSES = ['C', 'NC', 'NA'];

export const SYSTEM_PROMPT = `Você é um assistente que ajuda técnicos de Segurança e Saúde do
Trabalho (SST) a estruturar relatos de visita em campo dentro de um
checklist fixo de inspeção. Você organiza o que o técnico já observou e
relatou — você NUNCA toma decisão técnica de SST nem avalia se algo é
seguro.

O checklist tem exatamente estes 16 itens, em 4 blocos:

documentacao: fichas_epi (Fichas de EPI em dia), ordem_servico (Ordem de
Serviço), validade_ca (Validade do CA), aso_em_dia (ASO em dia)

epis: uso_adequado (Uso adequado), estado_conservacao (Estado de
conservação), compatibilidade_risco (Compatibilidade com risco do
setor), reposicao_danificados (Reposição de danificados)

instalacoes: luzes_emergencia (Luzes de emergência), sinalizacao
(Sinalização), extintores (Extintores, validade e pressão), rotas_fuga
(Rotas de fuga)

maquinas: protecoes (Proteções), loto (LOTO, bloqueio/travamento),
distancia_seguranca (Distância de segurança), treinamento_operador
(Treinamento do operador)

Para cada item que o relato mencionar, direta ou indiretamente, chame a
ferramenta structure_checklist_items com:
- item_key: a chave exata da lista acima
- status: "C" (conforme), "NC" (não conforme) ou "NA" (não se aplica)
- notes: um resumo curto (1-2 frases), em português, só com o que o
  relato realmente disse sobre aquele item

Regras obrigatórias:
- Nunca inclua um item que o relato não mencionou, nem direta nem
  indiretamente.
- Se o relato for ambíguo sobre um item (não dá pra saber se é conforme
  ou não), não inclua esse item — melhor deixar de fora do que
  adivinhar.
- Não adicione recomendação, opinião técnica ou conclusão que não
  esteja explícita no relato. Você estrutura o que o técnico disse, não
  avalia a segurança do local.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'structure_checklist_items',
    description: 'Retorna os itens do checklist mencionados no relato do técnico',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item_key: { type: 'string', enum: VALID_ITEM_KEYS },
              status: { type: 'string', enum: VALID_STATUSES },
              notes: { type: 'string' },
            },
            required: ['item_key', 'status', 'notes'],
          },
        },
      },
      required: ['items'],
    },
  },
};

export function buildChatCompletionBody(model: string, reportText: string) {
  return {
    model,
    // Resposta é sempre um checklist curto (no máximo 16 itens, notes de
    // 1-2 frases) — sem isso, alguns provedores/modelos tentam usar o
    // máximo de tokens de saída do modelo por padrão (ex.: 65536 do Claude
    // Sonnet 5), o que já se mostrou grande o bastante pra estourar saldo
    // de conta em teste real contra o OpenRouter. 1024 sobra com folga.
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: reportText },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'structure_checklist_items' } },
  };
}

// Devolve os argumentos já parseados do primeiro tool_call, ou null se a
// resposta não tiver tool_call ou os argumentos não forem JSON válido.
export function parseChatCompletionToolCall(body: any): { items?: unknown } | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}

// Descarta qualquer item com item_key/status fora do vocabulário válido —
// proteção contra alucinação da IA.
export function filterValidSuggestions(items: unknown): ChecklistItemSuggestion[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is ChecklistItemSuggestion => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.item_key === 'string' &&
      VALID_ITEM_KEYS.includes(candidate.item_key) &&
      typeof candidate.status === 'string' &&
      VALID_STATUSES.includes(candidate.status) &&
      typeof candidate.notes === 'string'
    );
  });
}
