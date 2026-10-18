import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { markDocumentProvisionsObsolete } from '../src/normative/provision-lifecycle';
import { GENERATION_ALLOWED_NORMAS, isGenerationAllowed, ProvisionsService, resolveKind } from '../src/normative/provisions.service';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';

type Call = { sql: string; params: any[] };

function montar(doc?: { id: string; status: string; content_hash: string; raw_text: string; code: string | null }, jaTemOutraVersao = false) {
  const calls: Call[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM normative_documents d')) return { rows: doc ? [doc] : [] };
      if (sql.includes('parser_version <>')) return { rows: jaTemOutraVersao ? [{ '?column?': 1 }] : [] };
      if (sql.includes('INSERT INTO normative_provisions')) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const com = (trecho: string) => calls.filter((c) => c.sql.includes(trecho));
  return { client, calls, com, service: new ProvisionsService() };
}

const RAW = '15.1 São consideradas atividades ou operações insalubres.\n15.1.1 Acima dos limites de tolerância.\n15.1.2 (Revogado)';
const doc = (over: object = {}) => ({ id: 'd1', status: 'vigente', content_hash: 'h1', raw_text: RAW, code: 'NR-15', ...over });

describe('markDocumentProvisionsObsolete', () => {
  it('regras revisadas ligadas voltam para "revisar" ANTES de os dispositivos virarem obsoletos', async () => {
    const { client, calls } = montar();
    await markDocumentProvisionsObsolete(client, 'd1');
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/UPDATE normative_rules SET status = 'revisar'/);
    expect(calls[0].sql).toMatch(/status = 'revisada'/);
    expect(calls[1].sql).toMatch(/UPDATE normative_provisions SET status = 'obsoleto'/);
    expect(calls[0].params).toEqual(['d1']);
  });
});

describe('ProvisionsService.generate', () => {
  const ENV = 'PROVISIONS_GENERATE_EXTRA_NORMAS';
  const envOriginal = process.env[ENV];
  afterEach(() => {
    if (envOriginal === undefined) delete process.env[ENV];
    else process.env[ENV] = envOriginal;
  });
  const escritas = (calls: Call[]) => calls.filter((c) => /^\s*(INSERT|UPDATE)\b/i.test(c.sql));

  it('documento inexistente → 404', async () => {
    const { service, client } = montar(undefined);
    await expect(service.generate(client, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('só documento vigente gera dispositivos', async () => {
    const { service, client } = montar(doc({ status: 'aguardando_validacao' }));
    await expect(service.generate(client, 'd1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fonte sem parser (código que não é NR/CLT/LEI-n/DEC-n) → 400, sem escrever', async () => {
    const { service, client, com } = montar(doc({ code: 'NHO 01' }));
    await expect(service.generate(client, 'd1')).rejects.toBeInstanceOf(BadRequestException);
    expect(com('INSERT INTO normative_provisions')).toHaveLength(0);
  });

  it('NR vigente: insere com hash do documento e versão do parser, e devolve o relatório', async () => {
    const { service, client, com } = montar(doc());
    const rep = await service.generate(client, 'd1');
    const ins = com('INSERT INTO normative_provisions')[0];
    expect(ins.params.slice(0, 4)).toEqual(['d1', 'NR-15', 'h1', 'provision-parser/1']);
    expect(ins.params[5]).toEqual(['15.1', '15.1.1', '15.1.2']);
    expect(ins.sql).toMatch(/ON CONFLICT .* DO NOTHING/s);
    // Parâmetros tipados no SELECT do INSERT…SELECT (Postgres não infere $n sem tipo ali).
    expect(ins.sql).toMatch(/SELECT \$1::uuid, \$2::text, .*\$3::text, \$4::text/);
    expect(rep).toMatchObject({ document_id: 'd1', norma: 'NR-15', parser_version: 'provision-parser/1', found: 3, inserted: 3 });
    expect(rep.coverage).toBeGreaterThan(0.9);
    expect(rep.anomalies_total).toBe(0);
  });

  it('offsets gravados em pontos de código (não UTF-16) quando há caractere astral antes dos itens', async () => {
    // SINTÉTICO: '𝑀' (U+1D440) ocupa 2 unidades UTF-16 e 1 ponto de código.
    const raw = 'Preâmbulo 𝑀.\n15.1 Primeiro item.\n15.2 Segundo 𝑀 item.\n15.3 Terceiro.';
    const { service, client, com } = montar(doc({ code: 'NR-15', raw_text: raw }));
    await service.generate(client, 'd1');
    const params = com('INSERT INTO normative_provisions')[0].params;
    const literais: string[] = params[6];
    const [starts, ends]: [number[], number[]] = [params[7], params[8]];
    const u16 = (l: string) => raw.indexOf(l);
    expect(starts).toEqual([u16('15.1') - 1, u16('15.2') - 1, u16('15.3') - 2]);
    const cps = Array.from(raw);
    literais.forEach((l, i) => expect(cps.slice(starts[i], ends[i]).join('')).toBe(l));
  });

  it('relatório corta a lista de anomalias em 200 mas devolve o total real', async () => {
    // SINTÉTICO: 250 cabeçalhos de anexo não reconhecidos → 250 anomalias. (`ANEXO (*)` deixou de servir: agora é
    // reconhecido como anexo '(*)' na primeira ocorrência.)
    const raw = Array.from({ length: 250 }, () => 'ANEXO \u201CA\u201D').join('\n');
    const { service, client } = montar(doc({ raw_text: raw }));
    const rep = await service.generate(client, 'd1');
    expect(rep.anomalies).toHaveLength(200);
    expect(rep.anomalies_total).toBe(250);
  });

  it('trava de geração: NR-12 (parser não validado) → 400 e NENHUM INSERT/UPDATE', async () => {
    delete process.env[ENV];
    const { service, client, calls } = montar(doc({ code: 'NR-12' }));
    const err = await service.generate(client, 'd1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(
      'Geração de dispositivos ainda não validada para NR-12 (parser validado só para NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048 e LEI-13709)',
    );
    expect(escritas(calls)).toEqual([]);
  });

  it('trava de geração: NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048 e LEI-13709 liberadas por padrão', async () => {
    delete process.env[ENV];
    expect(GENERATION_ALLOWED_NORMAS).toEqual(['NR-01', 'NR-07', 'NR-15', 'NR-16', 'CLT', 'LEI-8213', 'DEC-3048', 'LEI-13709']);
    for (const code of ['NR-01', 'NR-07', 'NR-15', 'NR-16']) {
      const { service, client, com } = montar(doc({ code }));
      expect((await service.generate(client, 'd1')).norma).toBe(code);
      expect(com('INSERT INTO normative_provisions')).toHaveLength(1);
    }
    // SINTÉTICO (estrutura mínima de artigo; os trechos reais estão em planalto-extract.unit-spec.ts e, da LGPD, em
    // provision-parser.unit-spec.ts).
    for (const [code, norma] of [['CLT', 'CLT'], ['LEI-8213', 'LEI-8213'], ['dec-3048', 'DEC-3048'], ['lei 13709', 'LEI-13709']]) {
      const { service, client, com } = montar(doc({ code, raw_text: 'Art. 57. Texto.\n§ 1º Parágrafo.' }));
      expect(await service.generate(client, 'd1')).toMatchObject({ norma, found: 2 });
      expect(com('INSERT INTO normative_provisions')[0].params[5]).toEqual(['art. 57', 'art. 57 §1']);
    }
  });

  it('trava de geração: LEI-8212 e DEC-4882 têm parser mas NÃO estão liberadas (sem aceite com texto real)', async () => {
    delete process.env[ENV];
    for (const code of ['LEI-8212', 'DEC-4882']) {
      const { service, client, calls } = montar(doc({ code, raw_text: 'Art. 1º Texto.' }));
      await expect(service.generate(client, 'd1')).rejects.toBeInstanceOf(BadRequestException);
      expect(escritas(calls)).toEqual([]);
    }
  });

  it('trava de geração: PROVISIONS_GENERATE_EXTRA_NORMAS estende a lista (lida na hora, com trim e caixa alta)', async () => {
    process.env[ENV] = ' nr-99 , CLT ';
    expect(isGenerationAllowed('NR-99')).toBe(true);
    expect(isGenerationAllowed('CLT')).toBe(true);
    expect(isGenerationAllowed('NR-12')).toBe(false);
    process.env[ENV] = 'NR-99';
    const { service, client, com } = montar(doc({ code: 'NR-99' }));
    expect((await service.generate(client, 'd1')).norma).toBe('NR-99');
    expect(com('INSERT INTO normative_provisions')).toHaveLength(1);
    delete process.env[ENV];
    expect(isGenerationAllowed('NR-99')).toBe(false);
  });

  it('código "NR 15" e "nr-15" normalizam para "NR-15"; "CLT" usa o parser de leis', async () => {
    const a = montar(doc({ code: 'NR 15' }));
    expect((await a.service.generate(a.client, 'd1')).norma).toBe('NR-15');
    // SINTÉTICO (estrutura mínima de artigo; não é texto da CLT).
    const b = montar(doc({ code: 'CLT', raw_text: 'Art. 192 Texto.' }));
    expect(await b.service.generate(b.client, 'd1')).toMatchObject({ norma: 'CLT', found: 1 });
    expect(b.com('INSERT INTO normative_provisions')[0].params[5]).toEqual(['art. 192']);
  });

  it('já existem dispositivos ativos de OUTRA versão do parser → marca obsoleto antes de gerar', async () => {
    const { service, client, calls } = montar(doc(), true);
    await service.generate(client, 'd1');
    const iObs = calls.findIndex((c) => c.sql.includes("UPDATE normative_provisions SET status = 'obsoleto'"));
    const iIns = calls.findIndex((c) => c.sql.includes('INSERT INTO normative_provisions'));
    expect(iObs).toBeGreaterThan(-1);
    expect(iObs).toBeLessThan(iIns);
  });

  it('texto sem estrutura reconhecida: nada inserido e relatório com found 0', async () => {
    const { service, client, com } = montar(doc({ raw_text: 'Sem itens aqui.' }));
    const rep = await service.generate(client, 'd1');
    expect(rep.found).toBe(0);
    expect(com('INSERT INTO normative_provisions')).toHaveLength(0);
  });
});

describe('resolveKind', () => {
  it('NR, CLT, LEI-<n> e DEC-<n> (normalizados em maiúsculas); o resto não tem parser', () => {
    expect(resolveKind('NR 7')).toEqual({ norma: 'NR-07', kind: 'nr' });
    expect(resolveKind(' clt ')).toEqual({ norma: 'CLT', kind: 'lei' });
    expect(resolveKind('LEI-8213')).toEqual({ norma: 'LEI-8213', kind: 'lei' });
    expect(resolveKind('lei 8212')).toEqual({ norma: 'LEI-8212', kind: 'lei' });
    expect(resolveKind('DEC-3048')).toEqual({ norma: 'DEC-3048', kind: 'lei' });
    expect(resolveKind('dec4882')).toEqual({ norma: 'DEC-4882', kind: 'lei' });
    // LGPD (Lei 13.709/2018): 5 dígitos.
    expect(resolveKind('LEI-13709')).toEqual({ norma: 'LEI-13709', kind: 'lei' });
    expect(resolveKind('lei13709')).toEqual({ norma: 'LEI-13709', kind: 'lei' });
    for (const c of [null, '', 'NR-15 e NR-16', 'LEI-8.213', 'DECRETO-3048', 'LEI-', 'IN-128', 'NHO 01']) {
      expect(() => resolveKind(c)).toThrow(BadRequestException);
    }
  });
});

describe('ProvisionsService.list', () => {
  it('filtra por documento/norma/anexo/status com parâmetros e limita a 500', async () => {
    const { service, client, calls } = montar();
    await service.list(client, { documentId: 'd1', norma: 'NR-15', anexo: '3', status: 'ativo', limit: 9999 });
    expect(calls[0].sql).toMatch(/document_id = \$1/);
    expect(calls[0].sql).toMatch(/norma = \$2/);
    expect(calls[0].sql).toMatch(/anexo = \$3/);
    expect(calls[0].sql).toMatch(/status = \$4/);
    expect(calls[0].params).toEqual(['d1', 'NR-15', '3', 'ativo', 500]);
  });

  it('sem filtros: status padrão "ativo"', async () => {
    const { service, client, calls } = montar();
    await service.list(client, {});
    expect(calls[0].params).toEqual(['ativo', 200]);
  });
});

describe('gancho de obsolescência no fluxo de documentos', () => {
  // Mock de client que registra SQL e parâmetros; `docStatus` é o status devolvido por findOne e
  // `rowCountDoc` o rowCount do UPDATE condicional do documento.
  function clienteDocs(opts: { docStatus: string; previousId?: string; rowCountDoc?: number }) {
    const calls: Call[] = [];
    const client: any = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT * FROM normative_documents')) return { rows: [{ id: params[0], status: opts.docStatus, source_id: 's1' }] };
        if (sql.includes('SELECT id FROM normative_documents WHERE source_id')) return { rows: opts.previousId ? [{ id: opts.previousId }] : [] };
        if (/UPDATE normative_documents[\s\S]*WHERE id = \$1 AND status/.test(sql)) return { rows: [], rowCount: opts.rowCountDoc ?? 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    const idx = (re: RegExp) => calls.findIndex((c) => re.test(c.sql));
    return { client, calls, idx, service: new NormativeDocumentsService({} as any, {} as any) };
  }
  const HOOK_REGRAS = /UPDATE normative_rules SET status = 'revisar'/;
  const HOOK_DISPOSITIVOS = /UPDATE normative_provisions SET status = 'obsoleto'/;

  it("finalizeApproval(): anterior 'substituido' → regras 'revisar' → dispositivos 'obsoleto' → novo 'vigente', com o id do ANTERIOR no gancho", async () => {
    const { client, calls, idx, service } = clienteDocs({ docStatus: 'aguardando_validacao', previousId: 'd-ant' });
    await service.finalizeApproval(client, 'd-novo', 'u1', []);
    const iSubst = idx(/UPDATE normative_documents SET status = 'substituido'/);
    const iRegras = idx(HOOK_REGRAS);
    const iDisp = idx(HOOK_DISPOSITIVOS);
    const iVig = idx(/SET status = 'vigente'/);
    expect([iSubst, iRegras, iDisp, iVig].every((i) => i > -1)).toBe(true);
    expect(iSubst).toBeLessThan(iRegras);
    expect(iRegras).toBeLessThan(iDisp);
    expect(iDisp).toBeLessThan(iVig);
    expect(calls[iSubst].params).toEqual(['d-ant']);
    expect(calls[iRegras].params).toEqual(['d-ant']);
    expect(calls[iDisp].params).toEqual(['d-ant']);
  });

  it('finalizeApproval() sem versão anterior vigente: o gancho não roda', async () => {
    const { client, idx, service } = clienteDocs({ docStatus: 'aguardando_validacao' });
    await service.finalizeApproval(client, 'd-novo', 'u1', []);
    expect(idx(HOOK_REGRAS)).toBe(-1);
    expect(idx(HOOK_DISPOSITIVOS)).toBe(-1);
  });

  it('retire(): o gancho roda DEPOIS do UPDATE do documento e com o id do documento', async () => {
    const { client, calls, idx, service } = clienteDocs({ docStatus: 'vigente' });
    await service.retire(client, 'd1', 'u1', 'motivo');
    const iDoc = idx(/UPDATE normative_documents[\s\S]*SET status = 'rejeitado'/);
    const iRegras = idx(HOOK_REGRAS);
    const iDisp = idx(HOOK_DISPOSITIVOS);
    expect(iDoc).toBeGreaterThan(-1);
    expect(iRegras).toBeGreaterThan(iDoc);
    expect(iDisp).toBeGreaterThan(iRegras);
    expect(calls[iRegras].params).toEqual(['d1']);
    expect(calls[iDisp].params).toEqual(['d1']);
  });

  it('retire(): se o UPDATE do documento não pega a linha (rowCount 0) → 409 e o gancho NÃO roda', async () => {
    const { client, idx, service } = clienteDocs({ docStatus: 'vigente', rowCountDoc: 0 });
    await expect(service.retire(client, 'd1', 'u1', 'motivo')).rejects.toBeInstanceOf(ConflictException);
    expect(idx(HOOK_REGRAS)).toBe(-1);
    expect(idx(HOOK_DISPOSITIVOS)).toBe(-1);
  });
});
