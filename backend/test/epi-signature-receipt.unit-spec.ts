import { buildReceiptPdf, ReceiptData } from '../src/epi-signature/receipt-pdf.util';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';

// Texto completo, com espaços normalizados (quebras de linha do pdfkit não importam para as asserções).
const textOf = async (b: Buffer) => ((await extractPdfTextFull(b)) ?? '').replace(/\s+/g, ' ');

const item = (i: number) => ({
  date: '2026-10-14', epi_description: `Capacete ${i}`, manufacturer: 'Fab', model: 'M1', ca_number: '12345', quantity: 2,
});
const sample: ReceiptData = {
  company: { name: 'Empresa Teste Ltda', cnpj: '12.345.678/0001-90' },
  employee: { full_name: 'Fulano de Tal', cpf_masked: '***.533.447-**' },
  receipt_code: 'ASEPI-20261015-ABCD1234',
  signed_at: '2026-10-15T12:30:00.000Z', // 09:30 em America/Sao_Paulo
  items: [item(1), item(2)],
  term: { version: 'rascunho-1', draft: true, title: 'Termo de recebimento e responsabilidade (RASCUNHO)', paragraphs: ['Declaro ter recebido os EPI.'] },
  term_text_sha256: 'd'.repeat(64),
  evidence_sha256: 'a'.repeat(64),
  signature_sha256: 'b'.repeat(64),
  ip: '203.0.113.9',
};

// Uma linha técnica "Página X de Y" por página, sem página extra em branco.
const umRodapePorPagina = (text: string) => {
  const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
  expect(m.length).toBeGreaterThan(0);
  const total = Number(/de (\d+)/.exec(m[0] as string)?.[1]);
  expect(m.length).toBe(total);
  expect(m[total - 1]).toBe(`Página ${total} de ${total}`);
  return total;
};

describe('buildReceiptPdf', () => {
  it('gera PDF válido com código, itens, CPF mascarado, hashes e a declaração de assinatura simples', async () => {
    const buf = await buildReceiptPdf(sample);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await textOf(buf);
    expect(text).toContain('ASEPI-20261015-ABCD1234');
    expect(text).toContain('***.533.447-**');
    expect(text).toContain('Assinatura eletrônica simples');
    expect(text).toContain('Assinatura eletrônica simples, registrada com aceite explícito, código de confirmação e evidências técnicas; não é assinatura digital com certificado ICP-Brasil.');
    expect(text).not.toMatch(/ICP-Brasil.*(válida|certificada)/i);
    expect(text).toContain('rascunho'.toUpperCase());
    expect(text).not.toMatch(/\b\d{11}\b/);
    expect(text).toContain('Capacete 1');
    expect(text).toContain('Capacete 2');
    expect(text).toContain('CA 12345');
    expect(text).toContain('Empresa Teste Ltda');
    expect(text).toContain('Fulano de Tal');
  });

  it('mostra data e hora em America/Sao_Paulo (dd/mm/aaaa hh:mm), sem ISO bruto nem "undefined"', async () => {
    const text = await textOf(await buildReceiptPdf(sample));
    expect(text).toContain('15/10/2026 09:30');
    expect(text).toContain('America/Sao_Paulo');
    expect(text).not.toContain('2026-10-15T');
    expect(text).not.toContain('undefined');
  });

  it('mostra os hashes, explica como foi calculada a evidência e que a imagem fica guardada à parte com seu hash', async () => {
    const text = await textOf(await buildReceiptPdf(sample));
    expect(text).toContain('a'.repeat(64));
    expect(text).toContain('b'.repeat(64));
    expect(text).toContain('d'.repeat(64));
    expect(text).toMatch(/SHA-256 do payload JSON da evidência/);
    expect(text).toMatch(/imagem da assinatura (é )?guardada separadamente/);
    expect(text).toContain('203.0.113.9');
  });

  it('termo aprovado (não rascunho) não imprime a marca RASCUNHO', async () => {
    const text = await textOf(await buildReceiptPdf({ ...sample, term: { version: 'v1', draft: false, title: 'Termo de recebimento', paragraphs: ['Declaro.'] } }));
    expect(text).not.toContain('RASCUNHO');
    expect(text).toContain('Termo de recebimento');
  });

  it('nome com emoji/CJK e muitos itens (80) não quebram o PDF e mantêm um rodapé por página', async () => {
    const data: ReceiptData = {
      ...sample,
      employee: { full_name: 'José 😀 山田太郎 Ñandú', cpf_masked: '***.533.447-**' },
      items: Array.from({ length: 80 }, (_, i) => ({ ...item(i), epi_description: i === 3 ? '手袋 😀\u0000nul' : `Capacete ${i}` })),
    };
    const buf = await buildReceiptPdf(data);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await textOf(buf);
    expect(umRodapePorPagina(text)).toBeGreaterThan(1);
    expect(text).toContain('Capacete 79');
    expect(text).toContain('ASEPI-20261015-ABCD1234');
  });

  it('termo longo e item com texto enorme não geram erro nem página em branco', async () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i} ` + 'texto do termo '.repeat(30));
    const buf = await buildReceiptPdf({ ...sample, term: { ...sample.term, paragraphs }, items: [{ ...item(1), epi_description: 'X'.repeat(600) }] });
    umRodapePorPagina(await textOf(buf));
  });

  it('data de assinatura inválida é erro de programação, nunca "undefined" no PDF', async () => {
    await expect(buildReceiptPdf({ ...sample, signed_at: 'não é data' })).rejects.toThrow(/signed_at/);
  });
});
