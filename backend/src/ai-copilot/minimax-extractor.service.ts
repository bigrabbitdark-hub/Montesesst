import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CHECKLIST_ITEMS } from '../inspections/checklist-items.const';
import { ChecklistItemSuggestion, FieldReportExtractor } from './field-report-extractor.interface';

const VALID_ITEM_KEYS = CHECKLIST_ITEMS.map((item) => item.item_key);
const VALID_STATUSES = ['C', 'NC', 'NA'];

const SYSTEM_PROMPT = `Você é um assistente que ajuda técnicos de Segurança e Saúde do
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

const TOOL_SCHEMA = {
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

@Injectable()
export class MiniMaxExtractorService implements FieldReportExtractor {
  private readonly logger = new Logger(MiniMaxExtractorService.name);

  async extract(reportText: string): Promise<ChecklistItemSuggestion[]> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Copiloto de IA ainda não está disponível');
    }

    const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
    let response: Response;
    try {
      response = await fetch('https://api.minimax.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: reportText },
          ],
          tools: [TOOL_SCHEMA],
          tool_choice: { type: 'function', function: { name: 'structure_checklist_items' } },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!response.ok) {
      this.logger.error(`MiniMax retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }
    const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      this.logger.error('Resposta do MiniMax sem tool_call');
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      this.logger.error('Argumentos do tool_call não são JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is ChecklistItemSuggestion => {
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
}
