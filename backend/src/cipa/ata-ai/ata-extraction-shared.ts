import { AtaDraftFields } from './ata-extractor.interface';

export const SYSTEM_PROMPT = `Você é um assistente que ajuda empresas a estruturar a ata de uma
reunião da CIPA (Comissão Interna de Prevenção de Acidentes) a partir da
transcrição em texto do áudio da reunião. Você organiza o que foi dito —
você NUNCA toma decisão técnica de segurança do trabalho nem avalia se
algo é seguro.

A ata tem 3 campos de texto:
- pauta: os assuntos planejados/anunciados para a reunião.
- discussoes: o que foi efetivamente discutido/relatado durante a reunião.
- deliberacoes: decisões, ações combinadas e encaminhamentos definidos.

Chame a ferramenta structure_ata_fields com os 3 campos preenchidos em
português, cada um um resumo claro e objetivo (não uma transcrição
literal) do que a transcrição contém para aquele campo. Se a transcrição
não tiver conteúdo claro pra um campo, devolva uma string vazia para ele
— nunca invente conteúdo que não está na transcrição.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'structure_ata_fields',
    description: 'Retorna os 3 campos estruturados da ata a partir da transcrição da reunião',
    parameters: {
      type: 'object',
      properties: {
        pauta: { type: 'string' },
        discussoes: { type: 'string' },
        deliberacoes: { type: 'string' },
      },
      required: ['pauta', 'discussoes', 'deliberacoes'],
    },
  },
};

export function buildChatCompletionBody(model: string, transcript: string) {
  return {
    model,
    // Resposta são 3 blocos de texto resumidos — 2048 dá folga suficiente
    // mesmo pra reuniões longas (a Fase 8 usou 1024 pra um checklist bem
    // mais curto), sem deixar o pedido tentar usar o teto de saída do
    // modelo por padrão (mesmo achado real da Fase 8: sem max_tokens
    // explícito, o pedido pode estourar saldo de conta).
    max_tokens: 2048,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'structure_ata_fields' } },
  };
}

export function parseChatCompletionToolCall(body: any): Record<string, unknown> | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}

// Garante que os 3 campos sempre existem como string, mesmo se a IA
// omitir um deles apesar do "required" do schema (alguns modelos não
// respeitam 100% do tempo) — proteção contra alucinação/omissão, mesmo
// espírito do filterValidSuggestions da Fase 8.
export function toAtaDraftFields(parsed: Record<string, unknown> | null): AtaDraftFields {
  return {
    pauta: typeof parsed?.pauta === 'string' ? parsed.pauta : '',
    discussoes: typeof parsed?.discussoes === 'string' ? parsed.discussoes : '',
    deliberacoes: typeof parsed?.deliberacoes === 'string' ? parsed.deliberacoes : '',
  };
}
