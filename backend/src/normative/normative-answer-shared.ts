export const SYSTEM_PROMPT = `Você é um assistente que responde perguntas sobre normas oficiais de
Segurança e Saúde do Trabalho (SST) brasileiras, usando SOMENTE os
trechos de fonte oficial fornecidos abaixo. Você nunca responde com
conhecimento próprio, memória ou suposição — só com o que está
literalmente nos trechos.

Para cada afirmação normativa que você fizer, chame a ferramenta
answer_with_citations com uma lista de itens, cada um com:
- claim: a afirmação em português, curta e direta
- chunk_ids: a lista dos ids dos trechos (fornecidos abaixo) que
  sustentam literalmente essa afirmação

Regras obrigatórias:
- Toda afirmação precisa de pelo menos um chunk_id real da lista de
  trechos fornecida. Nunca invente um chunk_id.
- Se os trechos fornecidos não contêm informação suficiente para
  responder a pergunta, devolva uma lista vazia de itens — não tente
  responder com conhecimento geral.
- Não dê conselho, opinião ou interpretação além do que os trechos
  literalmente dizem.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'answer_with_citations',
    description: 'Responde a pergunta normativa citando os trechos oficiais usados',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              chunk_ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['claim', 'chunk_ids'],
          },
        },
      },
      required: ['items'],
    },
  },
};

export function buildRagChatCompletionBody(
  model: string,
  question: string,
  chunks: { id: string; content: string }[],
) {
  const context = chunks.map((c) => `[${c.id}] ${c.content}`).join('\n\n');
  return {
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Trechos disponíveis:\n\n${context}\n\nPergunta: ${question}` },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'answer_with_citations' } },
  };
}

// Cópia local proposital do parser de tool_call (mesma lógica de
// checklist-extraction-shared.ts, na Fase 8) — mantém o módulo
// `normative` sem depender do módulo `ai-copilot` por uma função de 6
// linhas.
export function parseRagToolCall(body: any): { items?: unknown } | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}
