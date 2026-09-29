import { buildRagChatCompletionBody, SYSTEM_PROMPT, TOOL_SCHEMA } from '../src/normative/normative-answer-shared';

describe('buildRagChatCompletionBody — suporte a anexo (unit)', () => {
  it('sem anexo, o content da mensagem do usuário continua sendo uma string simples', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [{ id: 'c1', content: 'trecho' }], [], []);
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('pergunta');
  });

  it('com anexo pdf_text, o texto extraído entra como seção própria no content da mensagem', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], [], {
      kind: 'pdf_text',
      content: 'texto do pdf anexado',
    });
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('texto do pdf anexado');
    expect(body.messages[1].content).toContain('Conteúdo do documento anexado');
  });

  it('com anexo image, o content da mensagem vira um array com bloco de texto e bloco image_url', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], [], {
      kind: 'image',
      content: 'ZmFrZS1iYXNlNjQ=',
      mimeType: 'image/png',
    });
    expect(Array.isArray(body.messages[1].content)).toBe(true);
    const content = body.messages[1].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: expect.stringContaining('pergunta') });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,ZmFrZS1iYXNlNjQ=' },
    });
  });

  it('TOOL_SCHEMA exige uses_attachment, company_chunk_ids e checklist_ref_ids em cada item', () => {
    const itemSchema = (TOOL_SCHEMA.function.parameters.properties.items as any).items;
    expect(itemSchema.required).toContain('uses_attachment');
    expect(itemSchema.required).toContain('company_chunk_ids');
    expect(itemSchema.required).toContain('checklist_ref_ids');
    expect(itemSchema.properties.uses_attachment).toEqual({ type: 'boolean' });
    expect(itemSchema.properties.company_chunk_ids).toEqual({ type: 'array', items: { type: 'string' } });
    expect(itemSchema.properties.checklist_ref_ids).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('com trechos de documento da empresa, entram como seção própria no content', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [
      { id: 'cc1', content: 'Trecho do PGR da empresa sobre ruído' },
    ]);
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('Trecho do PGR da empresa sobre ruído');
    expect(body.messages[1].content).toContain('documentos da própria empresa');
  });

  it('com itens do checklist interno, entram como seção própria no content; sem itens, a seção é omitida', () => {
    const comItens = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], [
      { id: 'ck1', content: 'NR-13 — Prontuário de caldeira: registro da caldeira — item 13.5.1' },
    ]);
    expect(typeof comItens.messages[1].content).toBe('string');
    expect(comItens.messages[1].content).toContain('[ck1] NR-13 — Prontuário de caldeira');
    expect(comItens.messages[1].content).toContain('Itens do checklist interno de documentação SST da Montese');

    const semItens = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], []);
    expect(semItens.messages[1].content).not.toContain('Itens do checklist interno de documentação SST da Montese');
  });
});

describe('buildRagChatCompletionBody — orçamento de tokens (unit)', () => {
  it('max_tokens é 6144: o provedor ativo (MiniMax-M3) é modelo de raciocínio e o <think> consome o mesmo orçamento', () => {
    // Não baixe este valor sem entender: com 1024 o modelo gastava ~600-900
    // tokens raciocinando, batia no limite e o tool call vinha cortado em
    // '{"items": ' — o JSON.parse falhava e a pergunta caía no fallback em
    // silêncio. Medido: com 4096 a mesma pergunta completa (~2275 tokens),
    // mas em ~2% das chamadas 4096 ainda estourava; ~100 tokens/s → 6144
    // tokens ≈ 60 s, dentro do timeout do provedor (75 s).
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], []);
    expect(body.max_tokens).toBe(6144);
  });
});

// Achado da auditoria do Assistente (2026-09-28, item 017): este describe
// checava texto de jurisdição E de habilitação profissional dentro do
// SYSTEM_PROMPT. A regra de jurisdição continua no prompt (GEOGRAFIA/
// ESCOPO), só foi reescrita; a de habilitação profissional NÃO está mais
// no texto enviado ao modelo — migrou inteiramente para o detector
// determinístico `profissional_habilitado` em question-notices.ts (já
// coberto por seus próprios testes, ex. "profissional habilitado: quem
// pode assinar e ART"). Checar "habilitação legal" aqui testava uma
// versão antiga da arquitetura, não um requisito que ainda vale.
describe('SYSTEM_PROMPT — regra de jurisdição (unit)', () => {
  it('manda não responder como se a regra federal fosse universal quando depender de lei estadual/municipal', () => {
    expect(SYSTEM_PROMPT).toContain('NÃO há chunks suficientes');
    expect(SYSTEM_PROMPT).toContain('estaduais (Corpo de Bombeiros, secretarias estaduais do trabalho, CIPA estadual)');
    expect(SYSTEM_PROMPT).toContain('municipais (alvarás, posturas, códigos de obras)');
  });
});

describe('SYSTEM_PROMPT — checklist interno como fonte de curadoria, não texto oficial (unit)', () => {
  it('descreve checklist_ref_ids e deixa explícito que o checklist é curadoria Montese, nunca o texto oficial da norma', () => {
    expect(SYSTEM_PROMPT).toContain('checklist_ref_ids');
    expect(SYSTEM_PROMPT).toContain('NUNCA texto oficial da norma');
    expect(SYSTEM_PROMPT).toContain('curadoria Montese');
  });
});
