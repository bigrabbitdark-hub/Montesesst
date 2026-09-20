import { buildRagChatCompletionBody, SYSTEM_PROMPT, TOOL_SCHEMA } from '../src/normative/normative-answer-shared';

describe('buildRagChatCompletionBody — suporte a anexo (unit)', () => {
  it('sem anexo, o content da mensagem do usuário continua sendo uma string simples', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [{ id: 'c1', content: 'trecho' }], [], []);
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('pergunta');
  });

  it('com anexo pdf_text, o texto extraído entra como seção própria no content da mensagem', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], {
      kind: 'pdf_text',
      content: 'texto do pdf anexado',
    });
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('texto do pdf anexado');
    expect(body.messages[1].content).toContain('Conteúdo do documento anexado');
  });

  it('com anexo image, o content da mensagem vira um array com bloco de texto e bloco image_url', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [], {
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

  it('TOOL_SCHEMA exige uses_attachment e company_chunk_ids em cada item', () => {
    const itemSchema = (TOOL_SCHEMA.function.parameters.properties.items as any).items;
    expect(itemSchema.required).toContain('uses_attachment');
    expect(itemSchema.required).toContain('company_chunk_ids');
    expect(itemSchema.properties.uses_attachment).toEqual({ type: 'boolean' });
    expect(itemSchema.properties.company_chunk_ids).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('com trechos de documento da empresa, entram como seção própria no content', () => {
    const body = buildRagChatCompletionBody('modelo-teste', 'pergunta', [], [], [
      { id: 'cc1', content: 'Trecho do PGR da empresa sobre ruído' },
    ]);
    expect(typeof body.messages[1].content).toBe('string');
    expect(body.messages[1].content).toContain('Trecho do PGR da empresa sobre ruído');
    expect(body.messages[1].content).toContain('documentos da própria empresa');
  });
});

describe('SYSTEM_PROMPT — regra de jurisdição e habilitação profissional (unit)', () => {
  it('manda não responder como se a regra federal fosse universal quando depender de lei estadual/municipal ou de habilitação', () => {
    expect(SYSTEM_PROMPT).toContain('legislação estadual ou municipal');
    expect(SYSTEM_PROMPT).toContain('habilitação legal');
    expect(SYSTEM_PROMPT).toContain('declare explicitamente o que eles não cobrem');
  });
});
