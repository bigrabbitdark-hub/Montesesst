import { buildFichaPdf } from '../src/epi-ficha/ficha-pdf.util';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';

// Texto completo (sem o corte de 8000 caracteres de extractPdfText): o rodapé "Página X de Y" fica no fim de cada página.
const extractPdfText = async (b: Buffer) => (await extractPdfTextFull(b)) ?? '';

const base = {
  company: { name: 'Empresa Teste Ltda', trade_name: null, cnpj: '12345678000190', address: 'Rua A, 10 - Centro - Natal/RN - 59000000' },
  employee: { id: 'x', full_name: 'Fulano de Tal', cpf_masked: '***.533.447-**', registration_number: null, department: null, position: 'Soldador', admission_date: '2024-01-10', company_unit_name: null, status: 'ativo' },
  filters: {},
  term: { version: 'rascunho-1', draft: true, title: 'Termo de recebimento e responsabilidade (RASCUNHO)', paragraphs: ['Declaro ter recebido...'] },
};
const line = (i: number, over: Record<string, unknown> = {}) => ({
  source: 'livro', movement_id: `m${i}`, delivery_id: `d${i}`, date: '2026-10-14', type: 'entrega',
  epi_description: `Capacete ${i}`, manufacturer: 'Fab', model: 'M1', ca_number: '12345', quantity: 1, reason: 'Entrega',
  signature_status: 'pendente', reversed: false, ...over,
});

describe('buildFichaPdf', () => {
  it('gera PDF válido de prévia com marca NÃO EMITIDO, CPF mascarado e "não informada" para matrícula', async () => {
    const buf = await buildFichaPdf({ ...base, lines: [line(1)] } as any, { preview: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractPdfText(buf);
    expect(text).toContain('NÃO EMITIDO');
    expect(text).toContain('***.533.447-**');
    expect(text).toContain('não informada');
    expect(text).not.toMatch(/\b\d{11}\b/);
    expect(text).toContain('RASCUNHO');
  });

  it('PDF emitido traz código, versão e prefixo do hash; sem a marca de prévia', async () => {
    const buf = await buildFichaPdf({ ...base, lines: [line(1)] } as any, {
      preview: false, documentCode: 'FEPI-20261014-ABC123', version: 3, issuedAt: '2026-10-14T12:00:00.000Z', snapshotHash: 'a'.repeat(64),
    });
    const text = await extractPdfText(buf);
    expect(text).toContain('FEPI-20261014-ABC123');
    expect(text).toContain('Versão 3');
    expect(text).toContain('aaaaaaaaaaaa'); // prefixo do hash do instantâneo (12 caracteres)
    expect(text).not.toContain('NÃO EMITIDO');
  });

  it('muitas linhas geram várias páginas, cada uma com "Página X de Y"', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => line(i));
    const buf = await buildFichaPdf({ ...base, lines } as any, { preview: true });
    const text = await extractPdfText(buf);
    const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
    expect(m.length).toBeGreaterThan(1);
    expect(m[0]).toMatch(/Página 1 de \d+/);
    const total = Number(/de (\d+)/.exec(m[0] as string)?.[1]);
    expect(m.length).toBe(total); // uma linha técnica por página, sem página em branco extra
    expect(m[total - 1]).toBe(`Página ${total} de ${total}`);
  });

  it('não desenha selo/imagem de assinatura: pendente aparece como texto', async () => {
    const text = await extractPdfText(await buildFichaPdf({ ...base, lines: [line(1)] } as any, { preview: true }));
    expect(text).toContain('Pendente');
    expect(text).not.toMatch(/assinado digitalmente|ICP/i);
  });

  it('nome e termo com acentos e entrega legada sem quantidade ("—")', async () => {
    const text = await extractPdfText(await buildFichaPdf({
      ...base, lines: [line(1, { source: 'legado', type: 'entrega_legada', quantity: null, signature_status: 'legado' })],
    } as any, { preview: true }));
    expect(text).toContain('Histórico anterior ao módulo');
    expect(text).toContain('—');
  });

  it('assinatura presencial aparece como "Registrada presencialmente"', async () => {
    const text = await extractPdfText(await buildFichaPdf({
      ...base, lines: [line(1, { signature_status: 'presencial' })],
    } as any, { preview: true }));
    expect(text).toContain('Registrada presencialmente');
  });
  it('linha técnica formata a emissão como dd/mm/aaaa hh:mm em America/Sao_Paulo (sem ISO bruto)', async () => {
    const buf = await buildFichaPdf({ ...base, lines: [line(1)] } as any, {
      preview: false, documentCode: 'FEPI-20261014-ABC123', version: 1, issuedAt: '2026-10-14T12:00:00.000Z', snapshotHash: 'b'.repeat(64),
    });
    const text = await extractPdfText(buf);
    expect(text).toContain('Emitido em 14/10/2026 09:00');
    expect(text).not.toContain('2026-10-14T');
    expect(text).not.toContain('undefined');
  });

  it('emitido (preview=false) sem código, versão, data ou hash é erro de programação, nunca "undefined" no PDF', async () => {
    const ok = { preview: false, documentCode: 'FEPI-20261014-ABC123', version: 1, issuedAt: '2026-10-14T12:00:00.000Z', snapshotHash: 'c'.repeat(64) };
    const f = { ...base, lines: [line(1)] } as any;
    for (const campo of ['documentCode', 'version', 'issuedAt', 'snapshotHash']) {
      const meta: any = { ...ok };
      delete meta[campo];
      await expect(buildFichaPdf(f, meta)).rejects.toThrow(new RegExp(campo));
    }
    await expect(buildFichaPdf(f, { ...ok, issuedAt: 'não é data' })).rejects.toThrow(/issuedAt/);
  });

  // Casos hostis pedidos na revisão da Task 3 (regressão): sempre um rodapé por página, nunca erro.
  const uma_linha_tecnica_por_pagina = (text: string) => {
    const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
    const total = Number(/de (\d+)/.exec(m[0] as string)?.[1]);
    expect(m.length).toBe(total);
    expect(m[total - 1]).toBe(`Página ${total} de ${total}`);
  };

  it('nome com emoji/CJK e NUL no motivo geram PDF válido com um rodapé por página', async () => {
    const f = {
      ...base,
      employee: { ...base.employee, full_name: 'José 😀 山田太郎 Ñandú' },
      lines: [line(1, { reason: 'motivo\u0000com nul 😀 山田' }), line(2, { epi_description: '手袋 😀' })],
    } as any;
    const buf = await buildFichaPdf(f, { preview: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    uma_linha_tecnica_por_pagina(await extractPdfText(buf));
  });

  it('linha de tabela alta (motivo de 500 caracteres) mantém rodapé único por página', async () => {
    const lines = [line(1), line(2, { reason: 'palavra '.repeat(63).slice(0, 500) }), ...Array.from({ length: 40 }, (_, i) => line(i + 3))];
    const buf = await buildFichaPdf({ ...base, lines } as any, { preview: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    uma_linha_tecnica_por_pagina(await extractPdfText(buf));
  });

  it('termo longo (muitos parágrafos) não dá erro e todas as páginas têm rodapé', async () => {
    const paragraphs = Array.from({ length: 80 }, (_, i) => `Parágrafo ${i} ` + 'texto do termo '.repeat(30));
    const buf = await buildFichaPdf({ ...base, term: { ...base.term, paragraphs }, lines: [line(1)] } as any, { preview: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractPdfText(buf);
    expect((text.match(/Página \d+ de \d+/g) ?? []).length).toBeGreaterThan(2);
    uma_linha_tecnica_por_pagina(text);
  });
});

// ---- Subsistema 3, Task 4: status "assinada" e anexo "Comprovantes de assinatura" ----
import { makePng, makePngFromRaw, strokePng } from './helpers/png';

const umaLinhaPorPagina = (text: string) => {
  const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
  const total = Number(/de (\d+)/.exec(m[0] as string)?.[1]);
  expect(m.length).toBe(total);
  expect(m[total - 1]).toBe(`Página ${total} de ${total}`);
};
const flat = async (b: Buffer) => ((await extractPdfTextFull(b)) ?? '').replace(/\s+/g, ' ');
const sig = (i: number) => ({
  receipt_code: `ASEPI-20261014-${String(i).padStart(8, '0')}`,
  signed_at: '2026-10-14T12:00:00Z', // 09:00 em America/Sao_Paulo
  evidence_sha256: 'e'.repeat(63) + String(i % 10),
  signature_sha256: 'f'.repeat(63) + String(i % 10),
});
const signedLine = (i: number, s: ReturnType<typeof sig>) => line(i, { signature_status: 'assinada', receipt_code: s.receipt_code, signed_at: s.signed_at });
const emitMeta = { preview: false, documentCode: 'FEPI-20261014-ABC123', version: 2, issuedAt: '2026-10-14T13:00:00.000Z', snapshotHash: 'a'.repeat(64) } as const;

describe('buildFichaPdf: assinatura eletrônica (status e anexo)', () => {
  it('sem evidência: nenhuma imagem de assinatura, nenhum anexo e a linha "assinada" fica só "Assinada"', async () => {
    const buf = await buildFichaPdf({ ...base, signatures: [], lines: [line(1, { signature_status: 'assinada' })] } as any, emitMeta);
    const text = await flat(buf);
    expect(text).not.toContain('Comprovantes de assinatura');
    expect(text).not.toContain('Assinada eletronicamente');
    expect(text).toContain('Assinada');
    // ficha antiga (sem o campo signatures) continua válida
    expect((await flat(await buildFichaPdf({ ...base, lines: [line(1)] } as any, { preview: true }))).includes('Comprovantes de assinatura')).toBe(false);
  });

  it('linha assinada mostra data/hora em America/Sao_Paulo e o código do comprovante; anexo vem depois do termo', async () => {
    const s = sig(1);
    const png = strokePng();
    const buf = await buildFichaPdf({ ...base, signatures: [s], lines: [signedLine(1, s)] } as any, emitMeta, new Map([[s.receipt_code, png]]));
    const text = await flat(buf);
    expect(text).toContain('Assinada eletronicamente em 14/10/2026 09:00 (America/Sao_Paulo) — comprovante');
    expect(text.split(s.receipt_code).length - 1).toBeGreaterThanOrEqual(2); // na linha e no anexo
    const iTermo = text.indexOf('Versão do termo');
    const iAnexo = text.indexOf('Comprovantes de assinatura');
    expect(iTermo).toBeGreaterThan(0);
    expect(iAnexo).toBeGreaterThan(iTermo);
    expect(text).toContain('e'.repeat(63) + '1');
    expect(text).toContain('f'.repeat(63) + '1');
    expect(text).toContain('Assinatura eletrônica simples');
    expect(text).not.toMatch(/\b\d{11}\b/);
  });

  it('a imagem aparece só quando fornecida: prévia/sem mapa lista código e data, sem imagem', async () => {
    const s = sig(2);
    const comImg = await buildFichaPdf({ ...base, signatures: [s], lines: [signedLine(1, s)] } as any, emitMeta, new Map([[s.receipt_code, strokePng()]]));
    const semImg = await buildFichaPdf({ ...base, signatures: [s], lines: [signedLine(1, s)] } as any, { preview: true });
    const t = await flat(semImg);
    expect(t).toContain(s.receipt_code);
    expect(t).toContain('14/10/2026 09:00');
    expect(t).toContain('Comprovantes de assinatura');
    expect(comImg.length).toBeGreaterThan(semImg.length); // a imagem adicionou bytes
  });

  it('imagem ausente ou divergente na emissão é registrada no anexo como "imagem indisponível/divergente"', async () => {
    const s = sig(3);
    const buf = await buildFichaPdf({ ...base, signatures: [s], lines: [signedLine(1, s)] } as any, emitMeta, new Map());
    const t = await flat(buf);
    expect(t).toContain('imagem indisponível/divergente');
    expect(t).toContain(s.receipt_code);
  });

  it('mais de 100 assinaturas: só as 100 primeiras têm imagem; as demais listam código/data e há nota do limite', async () => {
    const sigs = Array.from({ length: 105 }, (_, i) => sig(i));
    const imgs = new Map(sigs.map((x) => [x.receipt_code, strokePng()] as const));
    const lines = sigs.map((x, i) => signedLine(i, x));
    const buf = await buildFichaPdf({ ...base, signatures: sigs, lines } as any, emitMeta, imgs);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const t = await flat(buf);
    expect(t).toContain(sigs[104].receipt_code);
    expect(t).toMatch(/limite de 100/);
    umaLinhaPorPagina(await extractPdfText(buf));
  });

  it('PDF seguro: imagens corrompidas NÃO derrubam o processo (nenhuma exceção assíncrona do pdfkit) e viram "indisponível"', async () => {
    const uncaught: unknown[] = [];
    const handler = (e: unknown) => { uncaught.push(e); };
    process.on('uncaughtException', handler);
    process.on('unhandledRejection', handler);
    try {
      const good = strokePng();
      // IDAT com fluxo zlib corrompido (o pdfkit lançaria dentro do callback assíncrono do zlib)
      const badZlib = makePng(300, 100);
      const iIdat = badZlib.indexOf(Buffer.from('IDAT'));
      const corrupt = Buffer.from(badZlib);
      corrupt.fill(0xff, iIdat + 6, iIdat + 20);
      // dados válidos mas com byte de filtro inválido (9): o png-js lança "Invalid filter algorithm"
      const rawBadFilter = Buffer.alloc(100 * (1 + 300 * 4), 0);
      for (let y = 0; y < 100; y++) rawBadFilter[y * (1 + 1200)] = 9;
      const badFilter = makePngFromRaw(300, 100, rawBadFilter);
      const truncated = good.subarray(0, 40);
      const notPng = Buffer.from('isto não é um PNG '.repeat(10));
      const hugeDims = Buffer.from(good);
      hugeDims.writeUInt32BE(0x7fffffff, 16); // largura gigante no IHDR (o CRC deixa de bater)
      const empty = Buffer.alloc(0);
      const cases = [corrupt, badFilter, truncated, notPng, hugeDims, empty];
      const sigs = [...cases.map((_, i) => sig(i)), sig(99)];
      const imgs = new Map<string, Buffer>(cases.map((b, i) => [sigs[i].receipt_code, b] as const));
      imgs.set(sigs[6].receipt_code, good);
      const buf = await buildFichaPdf({ ...base, signatures: sigs, lines: sigs.map((x, i) => signedLine(i, x)) } as any, emitMeta, imgs);
      await new Promise((r) => setTimeout(r, 300)); // dá tempo para qualquer callback assíncrono do zlib disparar
      expect(uncaught).toEqual([]);
      const t = await flat(buf);
      expect((t.match(/imagem indisponível\/divergente/g) ?? []).length).toBe(cases.length);
      expect(t).toContain(sigs[6].receipt_code);
      umaLinhaPorPagina(await extractPdfText(buf));
    } finally {
      process.off('uncaughtException', handler);
      process.off('unhandledRejection', handler);
    }
  });

  it('imagens fora do orçamento do documento aparecem como "imagem não incluída (limite do documento)"', async () => {
    const sigs = [sig(1), sig(2)];
    const buf = await buildFichaPdf({ ...base, signatures: sigs, lines: sigs.map((x, i) => signedLine(i, x)) } as any, { ...emitMeta, omittedImages: [sigs[1].receipt_code] }, new Map([[sigs[0].receipt_code, strokePng()]]));
    const t = await flat(buf);
    expect(t).toContain('imagem não incluída (limite do documento)');
    expect(t).not.toContain('imagem indisponível/divergente');
    expect(t).toContain(sigs[1].receipt_code);
  });
});
