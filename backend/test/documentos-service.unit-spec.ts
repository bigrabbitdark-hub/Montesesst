import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentosService, sanitizeFileName } from '../src/atuacao/documentos/documentos.service';
import { DocumentosController } from '../src/atuacao/documentos/documentos.controller';
import { AVISO_ASSINATURA_INTERNA, MSG_ACAO_NAO_HABILITADA } from '../src/atuacao/documentos/documento-fluxo';

// Fase 5A, Task 3: serviço do fluxo de documentos com `pg` e R2 simulados. Nenhum dado
// profissional real (conselho 'TESTE', número '0000').
const USER = '11111111-1111-4111-8111-111111111111';
const AUTOR = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';
const V1 = '55555555-5555-4555-8555-555555555555';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HASH_V1 = createHash('sha256').update(PDF).digest('hex');

type Call = { sql: string; params: any[] };
const rows = (r: any[]) => ({ rows: r, rowCount: r.length });

function draftRow(over: Record<string, any> = {}) {
  return {
    id: DRAFT, tenant_id: TENANT, category: 'pgr', title: 'Titulo sigiloso', status: 'em_elaboracao',
    current_version_id: V1, company_unit_id: null, elaboradores_ids: [AUTOR], versao_numero: 1,
    versao_sha256: HASH_V1, versao_file_key: 'documents-fluxo/x/y/1-abc', versao_file_name: 'a.pdf',
    versao_mime_type: 'application/pdf', versao_size_bytes: 10,
    ...over,
  };
}

function mk(over: {
  draft?: Record<string, any> | null; matriz?: string[]; registro?: any | null; maxVersao?: number;
  assinaturaVigente?: boolean; socioPerms?: string[]; versoes?: any[]; assinaturas?: any[]; tenantExiste?: boolean;
  responsavelAtivo?: boolean; pendentes?: number; correcoes?: any[]; correcaoStatus?: string | null;
} = {}) {
  const e = {
    draft: draftRow(), matriz: [] as string[], registro: null as any, maxVersao: 1, assinaturaVigente: true,
    socioPerms: ['documents.read', 'documents.create_draft', 'documents.review', 'documents.approve', 'documents.sign', 'documents.publish', 'documents.cancel'],
    versoes: [] as any[], assinaturas: [] as any[], tenantExiste: true,
    responsavelAtivo: true, pendentes: 0, correcoes: [] as any[], correcaoStatus: 'aberta' as string | null,
    ...over,
  };
  if (over.draft === null) e.draft = null as any;
  else if (over.draft) e.draft = draftRow(over.draft);
  const calls: Call[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (/FOR UPDATE OF d/.test(sql)) return rows(e.draft ? [e.draft] : []);
      if (/FROM document_type_permissions/.test(sql)) return rows(e.matriz.map((action) => ({ action })));
      if (/FROM professional_registrations/.test(sql)) return rows(e.registro ? [e.registro] : []);
      if (/MAX\(version_number\)/.test(sql)) return rows([{ proximo: e.maxVersao + 1 }]);
      if (/INSERT INTO document_draft_versions/.test(sql)) return rows([{ id: 'v-novo' }]);
      if (/INSERT INTO document_drafts/.test(sql)) return rows([{ id: DRAFT }]);
      if (/INSERT INTO documents/.test(sql)) return rows([{ id: 'doc-novo' }]);
      if (/INSERT INTO document_corrections/.test(sql)) return rows([{ id: 'corr-nova' }]);
      if (/INSERT INTO document_draft_signatures/.test(sql)) return rows([{ id: 'sig-novo' }]);
      if (/SELECT 1 FROM document_draft_signatures/.test(sql)) return rows(e.assinaturaVigente ? [{ '?column?': 1 }] : []);
      if (/FROM list_socios\(\) s WHERE s\.id = \$1/.test(sql)) return rows(e.responsavelAtivo ? [{ '?column?': 1 }] : []);
      if (/correcoes:pendentes/.test(sql)) return rows([{ n: e.pendentes }]);
      if (/correcoes:lista/.test(sql)) return rows(e.correcoes);
      if (/FROM document_corrections WHERE id = \$1/.test(sql)) return rows(e.correcaoStatus ? [{ status: e.correcaoStatus }] : []);
      if (/FROM tenants/.test(sql) && /SELECT id FROM tenants/.test(sql)) return rows(e.tenantExiste ? [{ id: TENANT }] : []);
      if (/FROM company_units/.test(sql)) return rows([]);
      if (/SELECT file_key, file_name FROM document_draft_versions/.test(sql)) return rows(e.versoes.slice(0, 1));
      if (/JOIN tenants t/.test(sql)) return rows(e.draft ? [{ ...e.draft, tenant_name: 'Cliente' }] : []);
      if (/FROM document_draft_versions v LEFT JOIN list_socios/.test(sql)) return rows(e.versoes);
      if (/FROM document_draft_events e/.test(sql)) return rows([]);
      if (/FROM document_draft_signatures s/.test(sql)) return rows(e.assinaturas);
      if (/FROM socio_permissions/.test(sql)) return rows(e.socioPerms.map((permission) => ({ permission })));
      return { rows: [], rowCount: 1 };
    }),
  };
  let abertas = 0;
  const abertasNoPut: number[] = [];
  const r2: any = {
    putObject: jest.fn(async () => { abertasNoPut.push(abertas); }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://r2.exemplo/url-temporaria'),
    getObject: jest.fn().mockResolvedValue(PDF),
  };
  const service = new DocumentosService(r2);
  const escritas = () => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
  const idx = (re: RegExp) => calls.findIndex((c) => re.test(c.sql));
  const ctx = async (fn: (c: any) => Promise<any>) => { abertas++; try { return await fn(client); } finally { abertas--; } };
  return { service, client, r2, calls, escritas, idx, ctx, abertasNoPut };
}

const arquivo = (over: Record<string, any> = {}) => ({ buffer: PDF, mimetype: 'application/pdf', originalname: 'laudo teste.pdf', size: PDF.length, ...over });
const msg = async (p: Promise<unknown>) => p.then(() => null, (err) => err);
const eventoDe = (calls: Call[], tipo: string) =>
  calls.find((c) => /INSERT INTO document_draft_events/.test(c.sql) && c.params.includes(tipo));

describe('DocumentosService — criar', () => {
  it('matriz vazia: 403 com a mensagem fixa e nada é gravado', async () => {
    const t = mk({ matriz: [] });
    const err = await msg(t.service.criar(t.client, USER, { tenant_id: TENANT, category: 'pgr', title: 'x' } as any));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(MSG_ACAO_NAO_HABILITADA);
    expect(t.escritas()).toEqual([]);
  });

  it('com a ação elaborar na matriz da categoria: grava o rascunho e o evento created', async () => {
    const t = mk({ matriz: ['elaborar'] });
    await t.service.criar(t.client, USER, { tenant_id: TENANT, category: 'pgr', title: 'x' } as any);
    const ins = t.calls.find((c) => /INSERT INTO document_drafts/.test(c.sql))!;
    expect(ins.params).toEqual(expect.arrayContaining([TENANT, 'pgr', 'x', USER]));
    expect(eventoDe(t.calls, 'created')).toBeTruthy();
  });

  it('só a matriz da própria categoria e do próprio usuário é consultada', async () => {
    const t = mk({ matriz: ['elaborar'] });
    await t.service.criar(t.client, USER, { tenant_id: TENANT, category: 'laudo', title: 'x' } as any);
    const q = t.calls.find((c) => /FROM document_type_permissions/.test(c.sql))!;
    expect(q.params).toEqual(['laudo', USER]);
  });

  it('cliente inexistente/fora da carteira: 404 e nada gravado', async () => {
    const t = mk({ matriz: ['elaborar'], tenantExiste: false });
    const err = await msg(t.service.criar(t.client, USER, { tenant_id: TENANT, category: 'pgr', title: 'x' } as any));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(t.escritas()).toEqual([]);
  });
});

describe('DocumentosService — nova versão', () => {
  it('calcula o SHA-256 do buffer no servidor, usa a chave documents-fluxo e grava versão, rascunho e evento', async () => {
    const t = mk({ matriz: ['elaborar'], maxVersao: 2, draft: { status: 'em_elaboracao' } });
    await t.service.novaVersao(t.ctx, USER, DRAFT, arquivo(), 'nota');
    const esperado = createHash('sha256').update(PDF).digest('hex');
    expect(t.r2.putObject).toHaveBeenCalledTimes(1);
    const [key, body, mime] = t.r2.putObject.mock.calls[0];
    expect(key).toMatch(new RegExp(`^documents-fluxo/${TENANT}/${DRAFT}/[0-9a-f-]{36}$`));
    expect(body).toBe(PDF);
    expect(mime).toBe('application/pdf');
    const ins = t.calls.find((c) => /INSERT INTO document_draft_versions/.test(c.sql))!;
    expect(ins.params).toContain(esperado);
    expect(ins.params).toContain(3);
    expect(ins.params).toContain(key);
    expect(ins.params).toContain(USER);
    expect(eventoDe(t.calls, 'version_added')).toBeTruthy();
  });

  it('ordem: ação/matriz avaliadas ANTES de qualquer toque no R2; matriz vazia: 403, sem R2 e sem gravação', async () => {
    const t = mk({ matriz: [] });
    const err = await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo()));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(MSG_ACAO_NAO_HABILITADA);
    expect(t.r2.putObject).not.toHaveBeenCalled();
    expect(t.escritas()).toEqual([]);
  });

  it('tipo não permitido e conteúdo que não confere com o tipo: 400 sem R2', async () => {
    const t = mk({ matriz: ['elaborar'] });
    const e1 = await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo({ mimetype: 'text/html' })));
    const e2 = await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo({ buffer: Buffer.from('<html>nao sou pdf</html>') })));
    expect(e1).toBeInstanceOf(BadRequestException);
    expect(e2).toBeInstanceOf(BadRequestException);
    expect(t.r2.putObject).not.toHaveBeenCalled();
    expect(t.escritas()).toEqual([]);
  });

  it('publicado e cancelado rejeitam nova versão (409) sem R2', async () => {
    for (const status of ['publicado', 'cancelado']) {
      const t = mk({ matriz: ['elaborar'], draft: { status } });
      const err = await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo()));
      expect(err).toBeInstanceOf(ConflictException);
      expect(t.r2.putObject).not.toHaveBeenCalled();
      expect(t.escritas()).toEqual([]);
    }
  });

  it('nova versão após aprovação/assinatura volta para em_elaboracao e NÃO apaga assinaturas antigas', async () => {
    for (const status of ['em_revisao', 'aprovado', 'assinado']) {
      const t = mk({ matriz: ['elaborar'], draft: { status } });
      await t.service.novaVersao(t.ctx, USER, DRAFT, arquivo());
      const upd = t.calls.find((c) => /UPDATE document_drafts/.test(c.sql))!;
      expect(upd.params).toContain('em_elaboracao');
      expect(upd.params).toContain('v-novo');
      expect(t.calls.some((c) => /(DELETE|UPDATE)[\s\S]*document_draft_signatures/.test(c.sql))).toBe(false);
    }
  });

  it('se a gravação no banco falhar depois do R2, o objeto é removido (best-effort)', async () => {
    const t = mk({ matriz: ['elaborar'] });
    const orig = t.client.query.getMockImplementation();
    t.client.query.mockImplementation(async (sql: string, p: any[]) => {
      if (/INSERT INTO document_draft_versions/.test(sql)) throw Object.assign(new Error('x'), { code: '23503' });
      return orig(sql, p);
    });
    await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo()));
    expect(t.r2.deleteObject).toHaveBeenCalledWith(t.r2.putObject.mock.calls[0][0]);
  });
});

describe('DocumentosService — transições e ordem das verificações', () => {
  it('enviar à revisão: exige estado em_elaboracao, versão e a ação elaborar', async () => {
    const t1 = mk({ matriz: ['elaborar'], draft: { status: 'em_revisao' } });
    expect(await msg(t1.service.enviarRevisao(t1.client, USER, DRAFT))).toBeInstanceOf(ConflictException);
    const t2 = mk({ matriz: ['elaborar'], draft: { current_version_id: null, elaboradores_ids: [] } });
    expect(await msg(t2.service.enviarRevisao(t2.client, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(t2.escritas()).toEqual([]);
    const t3 = mk({ matriz: [] });
    const e3 = await msg(t3.service.enviarRevisao(t3.client, USER, DRAFT));
    expect(e3).toBeInstanceOf(ForbiddenException);
    expect(t3.escritas()).toEqual([]);
    const t4 = mk({ matriz: ['elaborar'] });
    await t4.service.enviarRevisao(t4.client, USER, DRAFT);
    expect(t4.calls.find((c) => /UPDATE document_drafts/.test(c.sql))!.params).toContain('em_revisao');
    expect(eventoDe(t4.calls, 'submitted')).toBeTruthy();
  });

  it('todas as transições bloqueiam o rascunho com SELECT ... FOR UPDATE antes de qualquer escrita', async () => {
    const t = mk({ matriz: ['elaborar'] });
    await t.service.enviarRevisao(t.client, USER, DRAFT);
    const lock = t.idx(/FOR UPDATE OF d/);
    const primeiraEscrita = t.calls.findIndex((c) => /^\s*(INSERT|UPDATE)/i.test(c.sql));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(primeiraEscrita);
  });

  it('ordem estado -> matriz -> separação: estado inválido vence matriz vazia; matriz vazia vence a separação', async () => {
    const a = mk({ matriz: [], draft: { status: 'em_elaboracao' } });
    expect(await msg(a.service.devolver(a.client, USER, DRAFT, 'n'))).toBeInstanceOf(ConflictException);
    const b = mk({ matriz: [], draft: { status: 'em_revisao', elaboradores_ids: [USER] } });
    const eb = await msg(b.service.devolver(b.client, USER, DRAFT, 'n'));
    expect(eb).toBeInstanceOf(ForbiddenException);
    expect(eb.message).toBe(MSG_ACAO_NAO_HABILITADA);
  });

  it('devolver: o autor da versão pode devolver (separação desligada por decisão do proprietário); nota obrigatória (400); sucesso volta a em_elaboracao', async () => {
    const a = mk({ matriz: ['revisar'], draft: { status: 'em_revisao', elaboradores_ids: [USER] } });
    await a.service.devolver(a.client, USER, DRAFT, 'motivo');
    expect(eventoDe(a.calls, 'returned')).toBeTruthy();
    const b = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' } });
    expect(await msg(b.service.devolver(b.client, USER, DRAFT, '   '))).toBeInstanceOf(BadRequestException);
    expect(b.escritas()).toEqual([]);
    const c = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' } });
    await c.service.devolver(c.client, USER, DRAFT, 'ajustar o item 3');
    expect(c.calls.find((x) => /UPDATE document_drafts/.test(x.sql))!.params).toContain('em_elaboracao');
    const ev = eventoDe(c.calls, 'returned')!;
    expect(ev.params).toContain('ajustar o item 3');
  });

  it('aprovar: exige a ação aprovar; o ELABORADOR aprova (separação desligada); terceiro aprova', async () => {
    const a = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' } });
    expect(await msg(a.service.aprovar(a.client, USER, DRAFT))).toBeInstanceOf(ForbiddenException);
    const b = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao', elaboradores_ids: [USER] } });
    await b.service.aprovar(b.client, USER, DRAFT);
    expect(eventoDe(b.calls, 'approved')).toBeTruthy();
    const c = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' } });
    await c.service.aprovar(c.client, USER, DRAFT);
    expect(c.calls.find((x) => /UPDATE document_drafts/.test(x.sql))!.params).toContain('aprovado');
    expect(eventoDe(c.calls, 'approved')).toBeTruthy();
  });

  it('a mesma pessoa (não elaboradora) aprova, assina e publica quando a matriz permite', async () => {
    const reg = { id: 'r1', council: 'TESTE', registration_number: '0000', uf: 'SC' };
    const m = ['aprovar', 'assinar', 'publicar'];
    const a = mk({ matriz: m, draft: { status: 'em_revisao' } });
    await a.service.aprovar(a.client, USER, DRAFT);
    const b = mk({ matriz: m, draft: { status: 'aprovado' }, registro: reg });
    await b.service.assinar(b.client, USER, DRAFT, {});
    const c = mk({ matriz: m, draft: { status: 'assinado' } });
    await c.service.publicar(c.ctx, USER, DRAFT);
    expect(c.calls.some((x) => /INSERT INTO documents/.test(x.sql))).toBe(true);
  });

  it('assinar: registro não confirmado => 403 e nada gravado; sem estado aprovado => 409', async () => {
    const a = mk({ matriz: ['assinar'], draft: { status: 'aprovado' }, registro: null });
    const ea = await msg(a.service.assinar(a.client, USER, DRAFT, { ip: '1.1.1.1', userAgent: 'jest' }));
    expect(ea).toBeInstanceOf(ForbiddenException);
    expect(ea.message).toBe('Registro profissional não confirmado.');
    expect(a.escritas()).toEqual([]);
    const b = mk({ matriz: ['assinar'], draft: { status: 'em_revisao' }, registro: { id: 'r1', council: 'TESTE', registration_number: '0000', uf: 'SC' } });
    expect(await msg(b.service.assinar(b.client, USER, DRAFT, {}))).toBeInstanceOf(ConflictException);
  });

  it('assinar: grava snapshot do registro, hash da versão ATUAL, IP e user-agent, depois o estado e o evento', async () => {
    const t = mk({ matriz: ['assinar'], draft: { status: 'aprovado' }, registro: { id: 'r1', council: 'TESTE', registration_number: '0000', uf: 'SC' } });
    await t.service.assinar(t.client, USER, DRAFT, { ip: '10.0.0.9', userAgent: 'jest-agent' });
    const sig = t.calls.find((c) => /INSERT INTO document_draft_signatures/.test(c.sql))!;
    expect(sig.params).toEqual(expect.arrayContaining([DRAFT, TENANT, V1, USER, 'r1', 'TESTE', '0000', 'SC', HASH_V1, '10.0.0.9', 'jest-agent']));
    expect(t.idx(/INSERT INTO document_draft_signatures/)).toBeLessThan(t.idx(/UPDATE document_drafts/));
    expect(t.calls.find((c) => /UPDATE document_drafts/.test(c.sql))!.params).toContain('assinado');
    expect(eventoDe(t.calls, 'signed')).toBeTruthy();
  });

  it('assinar: trunca IP (64) e user-agent (300) ao limite do banco', async () => {
    const t = mk({ matriz: ['assinar'], draft: { status: 'aprovado' }, registro: { id: 'r1', council: 'TESTE', registration_number: '0000', uf: 'SC' } });
    await t.service.assinar(t.client, USER, DRAFT, { ip: 'i'.repeat(100), userAgent: 'u'.repeat(500) });
    const sig = t.calls.find((c) => /INSERT INTO document_draft_signatures/.test(c.sql))!;
    expect(sig.params).toContain('i'.repeat(64));
    expect(sig.params).toContain('u'.repeat(300));
  });

  it('publicar: só em assinado (409 nos demais) sem tocar no R2; exige a ação publicar; assinatura da versão atual', async () => {
    for (const status of ['em_elaboracao', 'em_revisao', 'aprovado', 'publicado', 'cancelado']) {
      const t = mk({ matriz: ['publicar'], draft: { status } });
      expect(await msg(t.service.publicar(t.ctx, USER, DRAFT))).toBeInstanceOf(ConflictException);
      expect(t.escritas()).toEqual([]);
      expect(t.r2.getObject).not.toHaveBeenCalled();
      expect(t.r2.putObject).not.toHaveBeenCalled();
    }
    const a = mk({ matriz: [], draft: { status: 'assinado' } });
    expect(await msg(a.service.publicar(a.ctx, USER, DRAFT))).toBeInstanceOf(ForbiddenException);
    expect(a.r2.getObject).not.toHaveBeenCalled();
    const b = mk({ matriz: ['publicar'], draft: { status: 'assinado' }, assinaturaVigente: false });
    expect(await msg(b.service.publicar(b.ctx, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(b.escritas()).toEqual([]);
    expect(b.r2.putObject).not.toHaveBeenCalled();
  });

  it('publicar: copia o objeto para uma NOVA chave (padrão de documents) e grava documents com ela; a versão mantém a chave original', async () => {
    const t = mk({ matriz: ['publicar'], draft: { status: 'assinado', company_unit_id: 'unit-1' } });
    await t.service.publicar(t.ctx, USER, DRAFT, '2030-12-31');
    expect(t.r2.getObject).toHaveBeenCalledWith('documents-fluxo/x/y/1-abc');
    const [nova, corpo, mime] = t.r2.putObject.mock.calls[0];
    expect(nova).toMatch(new RegExp(`^tenants/${TENANT}/documents/[0-9a-f-]{36}/a.pdf$`));
    expect(corpo).toBe(PDF);
    expect(mime).toBe('application/pdf');
    expect(nova).not.toBe('documents-fluxo/x/y/1-abc');
    const doc = t.calls.find((c) => /INSERT INTO documents/.test(c.sql))!;
    expect(doc.params).toEqual(expect.arrayContaining([
      TENANT, 'pgr', 'Titulo sigiloso', nova, 'a.pdf', 'application/pdf', 10, '2030-12-31', USER, 'unit-1',
    ]));
    expect(doc.params).not.toContain('documents-fluxo/x/y/1-abc');
    expect(doc.sql).toMatch(/'socio'/);
    const iKey = t.idx(/publish_file_key/);
    const iDoc = t.idx(/INSERT INTO documents/);
    const iUpd = t.calls.findIndex((c) => /UPDATE document_drafts/.test(c.sql) && c.params.includes('publicado'));
    const iEv = t.idx(/INSERT INTO document_draft_events/);
    expect(iKey).toBeGreaterThanOrEqual(0);
    expect(iKey).toBeLessThan(iDoc);
    expect(iDoc).toBeLessThan(iUpd);
    expect(iUpd).toBeLessThan(iEv);
    expect(t.calls[iKey].params).toContain(nova);
    expect(t.calls[iUpd].params).toEqual(expect.arrayContaining(['publicado', expect.any(String)]));
    expect(eventoDe(t.calls, 'published')).toBeTruthy();
    expect(t.r2.deleteObject).not.toHaveBeenCalled(); // a chave da versão nunca é apagada
  });

  it('publicar: falha na gravação depois da cópia apaga SÓ a cópia (best-effort)', async () => {
    const t = mk({ matriz: ['publicar'], draft: { status: 'assinado' } });
    const orig = t.client.query.getMockImplementation();
    t.client.query.mockImplementation(async (sql: string, p: any[]) => {
      if (/INSERT INTO documents/.test(sql)) throw Object.assign(new Error('x'), { code: '42501' });
      return orig(sql, p);
    });
    expect(await msg(t.service.publicar(t.ctx, USER, DRAFT))).toBeInstanceOf(ForbiddenException);
    const nova = t.r2.putObject.mock.calls[0][0];
    expect(t.r2.deleteObject).toHaveBeenCalledTimes(1);
    expect(t.r2.deleteObject).toHaveBeenCalledWith(nova);
  });

  it('publicar: o estado mudou entre as duas fases (outra versão) => 409 e a cópia é apagada; nada publicado', async () => {
    const t = mk({ matriz: ['publicar'], draft: { status: 'assinado' } });
    const orig = t.client.query.getMockImplementation();
    let travas = 0;
    t.client.query.mockImplementation(async (sql: string, p: any[]) => {
      if (/FOR UPDATE OF d/.test(sql) && ++travas === 2) return rows([draftRow({ status: 'assinado', current_version_id: 'outra-versao' })]);
      return orig(sql, p);
    });
    expect(await msg(t.service.publicar(t.ctx, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(t.r2.deleteObject).toHaveBeenCalledWith(t.r2.putObject.mock.calls[0][0]);
    expect(t.calls.some((c) => /INSERT INTO documents/.test(c.sql))).toBe(false);
  });

  it('publicar: objeto do R2 que não confere com o hash da versão => 409, sem cópia e sem gravação', async () => {
    const t = mk({ matriz: ['publicar'], draft: { status: 'assinado' } });
    t.r2.getObject.mockResolvedValue(Buffer.from('conteudo adulterado'));
    expect(await msg(t.service.publicar(t.ctx, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(t.r2.putObject).not.toHaveBeenCalled();
    expect(t.escritas()).toEqual([]);
  });

  it('cancelar: nota obrigatória; usa a ação elaborar; terminais não cancelam (409)', async () => {
    const a = mk({ matriz: ['elaborar'] });
    expect(await msg(a.service.cancelar(a.client, USER, DRAFT, ' '))).toBeInstanceOf(BadRequestException);
    expect(a.escritas()).toEqual([]);
    const b = mk({ matriz: ['elaborar'], draft: { status: 'publicado' } });
    expect(await msg(b.service.cancelar(b.client, USER, DRAFT, 'x'))).toBeInstanceOf(ConflictException);
    const c = mk({ matriz: [] });
    expect(await msg(c.service.cancelar(c.client, USER, DRAFT, 'x'))).toBeInstanceOf(ForbiddenException);
    const d = mk({ matriz: ['elaborar', 'aprovar'], draft: { status: 'aprovado' } });
    await d.service.cancelar(d.client, USER, DRAFT, 'motivo');
    expect(d.calls.find((x) => /UPDATE document_drafts/.test(x.sql))!.params).toContain('cancelado');
    expect(eventoDe(d.calls, 'cancelled')).toBeTruthy();
  });

  it('rascunho inexistente ou invisível pela RLS: 404', async () => {
    const t = mk({ draft: null });
    expect(await msg(t.service.aprovar(t.client, USER, DRAFT))).toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentosService — detalhe e download', () => {
  const sig = (versionId: string) => ({ id: 's', version_id: versionId, version_number: 1, council: 'TESTE', registration_number: '0000', uf: 'SC', version_sha256: HASH_V1, signed_at: 'x', signer_user_id: AUTOR, signer_name: 'N' });

  it('traz aviso exato, vigente só para a versão atual e ações calculadas pela mesma função pura', async () => {
    const t = mk({
      matriz: ['revisar', 'aprovar'], draft: { status: 'em_revisao', elaboradores_ids: [USER] },
      assinaturas: [sig(V1), sig('outra-versao')],
    });
    const d = await t.service.obter(t.client, USER, DRAFT);
    expect(d.aviso_assinatura).toBe(AVISO_ASSINATURA_INTERNA);
    expect(d.assinaturas.map((s: any) => s.vigente)).toEqual([true, false]);
    // elaborador com revisar e aprovar na matriz: separação desligada, as ações são oferecidas
    expect(d.acoes_permitidas).toEqual(expect.arrayContaining(['aprovar']));
  });

  it('sem permissão RBAC a ação não é oferecida; matriz vazia não oferece nenhuma', async () => {
    const t = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' }, socioPerms: ['documents.read'] });
    expect((await t.service.obter(t.client, USER, DRAFT)).acoes_permitidas).toEqual([]);
    const v = mk({ matriz: [], draft: { status: 'em_revisao' } });
    expect((await v.service.obter(v.client, USER, DRAFT)).acoes_permitidas).toEqual([]);
  });

  it('download: 404 quando a versão não é visível; senão URL temporária do R2', async () => {
    const a = mk({ versoes: [] });
    expect(await msg(a.service.downloadVersao(a.client, DRAFT, V1))).toBeInstanceOf(NotFoundException);
    const b = mk({ versoes: [{ file_key: 'k/1', file_name: 'a.pdf' }] });
    expect(await b.service.downloadVersao(b.client, DRAFT, V1)).toEqual({ url: 'https://r2.exemplo/url-temporaria', file_name: 'a.pdf' });
    expect(b.r2.getPresignedDownloadUrl).toHaveBeenCalledWith('k/1');
  });

  it('nenhuma mensagem de erro do serviço usa os termos proibidos', async () => {
    const mensagens: string[] = [];
    const casos: Array<() => Promise<unknown>> = [
      async () => { const t = mk({ matriz: [] }); return t.service.aprovar(t.client, USER, DRAFT); },
      async () => { const t = mk({ matriz: ['assinar'], draft: { status: 'aprovado' } }); return t.service.assinar(t.client, USER, DRAFT, {}); },
      async () => { const t = mk({ matriz: ['publicar'], draft: { status: 'aprovado' } }); return t.service.publicar(t.ctx, USER, DRAFT); },
      async () => { const t = mk({ matriz: ['elaborar'], draft: { status: 'publicado' } }); return t.service.novaVersao(t.ctx, USER, DRAFT, arquivo()); },
    ];
    for (const c of casos) mensagens.push(String((await msg(c()))?.message));
    for (const m of mensagens) expect(m).not.toMatch(/assinatura digital|ICP-Brasil/i);
  });
});

describe('DocumentosService — rodada 2', () => {
  it('nova versão: putObject ocorre FORA de qualquer transação; sucesso mantém o objeto', async () => {
    const t = mk({ matriz: ['elaborar'] });
    await t.service.novaVersao(t.ctx, USER, DRAFT, arquivo());
    expect(t.abertasNoPut).toEqual([0]);
    expect(t.r2.deleteObject).not.toHaveBeenCalled();
    // a numeração é calculada DENTRO da transação que trava o rascunho (segunda trava)
    const travas = t.calls.map((c, i) => (/FOR UPDATE OF d/.test(c.sql) ? i : -1)).filter((i) => i >= 0);
    expect(travas).toHaveLength(2);
    expect(t.idx(/MAX\(version_number\)/)).toBeGreaterThan(travas[1]);
    expect(t.calls.findIndex((c) => /MAX\(version_number\)/.test(c.sql))).toBeGreaterThan(travas[1]);
  });

  it('nova versão: o estado mudou entre as fases (publicado) => 409 e o objeto enviado é apagado', async () => {
    const t = mk({ matriz: ['elaborar'] });
    const orig = t.client.query.getMockImplementation();
    let n = 0;
    t.client.query.mockImplementation(async (sql: string, p: any[]) => {
      if (/FOR UPDATE OF d/.test(sql) && ++n === 2) return rows([draftRow({ status: 'publicado' })]);
      return orig(sql, p);
    });
    expect(await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo()))).toBeInstanceOf(ConflictException);
    expect(t.r2.deleteObject).toHaveBeenCalledWith(t.r2.putObject.mock.calls[0][0]);
    expect(t.calls.some((c) => /INSERT INTO document_draft_versions/.test(c.sql))).toBe(false);
  });

  it('cancelar: elaborador sem assinar não cancela documento assinado (403, nada muda); com ambas cancela; publicado => 409', async () => {
    const a = mk({ matriz: ['elaborar'], draft: { status: 'assinado' } });
    const e = await msg(a.service.cancelar(a.client, USER, DRAFT, 'x'));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.message).toBe(MSG_ACAO_NAO_HABILITADA);
    expect(a.escritas()).toEqual([]);
    const b = mk({ matriz: ['elaborar', 'assinar'], draft: { status: 'assinado' } });
    await b.service.cancelar(b.client, USER, DRAFT, 'x');
    expect(b.calls.find((c) => /UPDATE document_drafts/.test(c.sql))!.params).toContain('cancelado');
    const c = mk({ matriz: ['elaborar', 'aprovar', 'assinar'], draft: { status: 'publicado' } });
    expect(await msg(c.service.cancelar(c.client, USER, DRAFT, 'x'))).toBeInstanceOf(ConflictException);
    const d = mk({ matriz: ['elaborar'], draft: { status: 'aprovado' } });
    expect(await msg(d.service.cancelar(d.client, USER, DRAFT, 'x'))).toBeInstanceOf(ForbiddenException);
  });

  it('acoes_permitidas só oferece cancelar quando a regra conservadora é atendida', async () => {
    const a = mk({ matriz: ['elaborar'], draft: { status: 'assinado' } });
    expect((await a.service.obter(a.client, USER, DRAFT)).acoes_permitidas).not.toContain('cancelar');
    const b = mk({ matriz: ['elaborar', 'assinar'], draft: { status: 'assinado' } });
    expect((await b.service.obter(b.client, USER, DRAFT)).acoes_permitidas).toContain('cancelar');
  });

  it('aprovar e assinar gravam o evento/assinatura ANTES de mudar o status (exigência dos triggers)', async () => {
    const a = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' } });
    await a.service.aprovar(a.client, USER, DRAFT);
    expect(a.idx(/INSERT INTO document_draft_events/)).toBeLessThan(a.idx(/UPDATE document_drafts/));
    const b = mk({ matriz: ['assinar'], draft: { status: 'aprovado' }, registro: { id: 'r1', council: 'TESTE', registration_number: '0000', uf: 'SC' } });
    await b.service.assinar(b.client, USER, DRAFT, {});
    expect(b.idx(/INSERT INTO document_draft_signatures/)).toBeLessThan(b.idx(/UPDATE document_drafts/));
    expect(b.idx(/INSERT INTO document_draft_events/)).toBeLessThan(b.idx(/UPDATE document_drafts/));
  });

  it('sanitizeFileName: limita a 120 caracteres mantendo a extensão; rejeita nomes só de pontos', () => {
    const longo = `${'a'.repeat(300)}.pdf`;
    const r = sanitizeFileName(longo);
    expect(r.length).toBeLessThanOrEqual(120);
    expect(r.endsWith('.pdf')).toBe(true);
    expect(sanitizeFileName('dir/sub\\Laudo ção.pdf')).toBe('Laudo___o.pdf');
    for (const ruim of ['..', '.', '...', 'x/..']) expect(() => sanitizeFileName(ruim)).toThrow(BadRequestException);
  });

  it('nova versão com nome só de pontos: 400 sem R2', async () => {
    const t = mk({ matriz: ['elaborar'] });
    expect(await msg(t.service.novaVersao(t.ctx, USER, DRAFT, arquivo({ originalname: '..' })))).toBeInstanceOf(BadRequestException);
    expect(t.r2.putObject).not.toHaveBeenCalled();
  });

  it('negações por matriz/estado/registro carregam o código para a auditoria', async () => {
    const casos: Array<[string, () => Promise<unknown>]> = [
      ['MATRIZ', async () => { const t = mk({ matriz: [] }); return t.service.enviarRevisao(t.client, USER, DRAFT); }],
      ['ESTADO', async () => { const t = mk({ matriz: ['elaborar'], draft: { status: 'em_revisao' } }); return t.service.enviarRevisao(t.client, USER, DRAFT); }],
      ['REGISTRO', async () => { const t = mk({ matriz: ['assinar'], draft: { status: 'aprovado' } }); return t.service.assinar(t.client, USER, DRAFT, {}); }],
    ];
    for (const [codigo, fn] of casos) expect([codigo, (await msg(fn())).codigoNegacao]).toEqual([codigo, codigo]);
  });

  it('controller grava document_draft.denied (ids e códigos, sem título/nota, path sem query) sem mudar a resposta', async () => {
    const t = mk({ matriz: [] });
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const ctrl = new DocumentosController(t.service, audit);
    const req: any = {
      user: { id: USER, role: 'socio' }, method: 'POST', path: `/atuacao/documentos/${DRAFT}/aprovar`, ip: '1.1.1.1',
      withTenantContext: (fn: any) => fn(t.client),
    };
    const err = await msg(ctrl.aprovar(DRAFT, {}, req));
    expect(err).toBeInstanceOf(ConflictException); // estado em_elaboracao
    expect(audit.log).toHaveBeenCalledTimes(1);
    const e = audit.log.mock.calls[0][0];
    expect(e).toMatchObject({ action: 'document_draft.denied', resourceType: 'document_draft', resourceId: DRAFT, actorUserId: USER, path: req.path, statusCode: 409 });
    expect(e.detail).toContain('ESTADO');
    expect(e.detail).toContain('aprovar');
    expect(e.detail).not.toContain('Titulo sigiloso');
  });
});

describe('DocumentosService — rodada 2 (H, I, J)', () => {
  it('H: quem criou o rascunho, autor de versão antiga e quem submeteu contam como elaboradores (a consulta os reúne)', async () => {
    const t = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' } });
    await t.service.aprovar(t.client, USER, DRAFT);
    const lock = t.calls.find((c) => /FOR UPDATE OF d/.test(c.sql))!.sql;
    expect(lock).toMatch(/d\.created_by/);
    expect(lock).toMatch(/FROM document_draft_versions/);
    expect(lock).toMatch(/type = 'submitted'/);
    expect(lock).toMatch(/elaboradores_ids/);
  });

  it('H: devolver (revisar) por elaborador é permitido (separação desligada); sem a ação na matriz segue negado', async () => {
    for (const elab of [[USER], [AUTOR, USER]]) {
      const t = mk({ matriz: ['revisar'], draft: { status: 'em_revisao', elaboradores_ids: elab } });
      await t.service.devolver(t.client, USER, DRAFT, 'n');
      expect(eventoDe(t.calls, 'returned')).toBeTruthy();
    }
    const n = mk({ matriz: [], draft: { status: 'em_revisao', elaboradores_ids: [USER] } });
    expect((await msg(n.service.devolver(n.client, USER, DRAFT, 'n'))).codigoNegacao).toBe('MATRIZ');
  });

  it('I: cancelar só é oferecido com documents.cancel e a nota registra o estado de origem; histórico não é apagado', async () => {
    const a = mk({ matriz: ['elaborar', 'assinar'], draft: { status: 'assinado' }, socioPerms: ['documents.read', 'documents.create_draft'] });
    expect((await a.service.obter(a.client, USER, DRAFT)).acoes_permitidas).not.toContain('cancelar');
    const b = mk({ matriz: ['elaborar', 'assinar'], draft: { status: 'assinado' }, socioPerms: ['documents.read', 'documents.cancel'] });
    expect((await b.service.obter(b.client, USER, DRAFT)).acoes_permitidas).toContain('cancelar');
    await b.service.cancelar(b.client, USER, DRAFT, 'motivo X');
    const ev = eventoDe(b.calls, 'cancelled')!;
    expect(ev.params.find((p: any) => typeof p === 'string' && p.includes('motivo X'))).toMatch(/origem: assinado/);
    expect(b.calls.some((c) => /DELETE/i.test(c.sql))).toBe(false);
  });

  const sigRow = { id: 's', version_id: V1, version_number: 1, council: 'TESTE', registration_number: '0000', uf: 'SC', version_sha256: HASH_V1, signed_at: 'x', signer_user_id: AUTOR, signer_name: 'Nome Signatario' };

  it('J: sem documents.view_registration o JSON inteiro não traz conselho/número/UF; só registro_confirmado e o nome', async () => {
    const t = mk({ assinaturas: [sigRow], socioPerms: ['documents.read'] });
    const d = await t.service.obter(t.client, USER, DRAFT);
    const json = JSON.stringify(d);
    expect(json).not.toContain('TESTE');
    expect(json).not.toContain('0000');
    expect(json).not.toMatch(/"(council|registration_number|uf)"/);
    expect(d.assinaturas[0]).toMatchObject({ registro_confirmado: true, signer_name: 'Nome Signatario', vigente: true });
  });

  it('J: com documents.view_registration os campos do snapshot aparecem', async () => {
    const t = mk({ assinaturas: [sigRow], socioPerms: ['documents.read', 'documents.view_registration'] });
    const d = await t.service.obter(t.client, USER, DRAFT);
    expect(d.assinaturas[0]).toMatchObject({ council: 'TESTE', registration_number: '0000', uf: 'SC', registro_confirmado: true });
  });
});


describe('DocumentosService — correções estruturadas (E2)', () => {
  const CORR = '77777777-7777-4777-8777-777777777777';
  const ins = (calls: Call[]) => calls.find((c) => /INSERT INTO document_corrections/.test(c.sql));

  it('devolver cria a correção (origem revisao) com a nota como descrição, responsável e prazo informados', async () => {
    const t = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' } });
    await t.service.devolver(t.client, USER, DRAFT, 'ajustar o item 3', { responsavelId: AUTOR, prazo: '2026-12-01' });
    const c = ins(t.calls)!;
    expect(c.params).toEqual([DRAFT, TENANT, V1, 'ajustar o item 3', 'revisao', null, USER, AUTOR, '2026-12-01']);
    expect(eventoDe(t.calls, 'returned')).toBeTruthy();
  });

  it('devolver sem responsável usa o autor da versão atual; responsável que não é sócio ativo => 400 e nada gravado', async () => {
    const t = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' } });
    await t.service.devolver(t.client, USER, DRAFT, 'x');
    expect(ins(t.calls)!.params[7]).toBe(USER); // mock sem autor da versão: cai no próprio usuário
    const n = mk({ matriz: ['revisar'], draft: { status: 'em_revisao' }, responsavelAtivo: false });
    expect(await msg(n.service.devolver(n.client, USER, DRAFT, 'x', { responsavelId: AUTOR }))).toBeInstanceOf(BadRequestException);
    expect(n.escritas()).toEqual([]);
  });

  it('aprovar, assinar e publicar são bloqueados (409) enquanto houver correção aberta ou corrigida', async () => {
    const a = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' }, pendentes: 1 });
    expect(await msg(a.service.aprovar(a.client, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(a.escritas()).toEqual([]);
    const s = mk({ matriz: ['assinar'], draft: { status: 'aprovado' }, registro: { id: 'r', council: 'TESTE', registration_number: '0000', uf: 'SC' }, pendentes: 2 });
    expect(await msg(s.service.assinar(s.client, USER, DRAFT, {}))).toBeInstanceOf(ConflictException);
    expect(s.escritas()).toEqual([]);
    const p = mk({ matriz: ['publicar'], draft: { status: 'assinado' }, pendentes: 1 });
    expect(await msg(p.service.publicar(p.ctx, USER, DRAFT))).toBeInstanceOf(ConflictException);
    expect(p.r2.getObject).not.toHaveBeenCalled();
  });

  it('sem correções pendentes a aprovação segue normal', async () => {
    const a = mk({ matriz: ['aprovar'], draft: { status: 'em_revisao' }, pendentes: 0 });
    await a.service.aprovar(a.client, USER, DRAFT);
    expect(eventoDe(a.calls, 'approved')).toBeTruthy();
  });

  it('registrar correção do cliente exige quem solicitou; documento publicado/cancelado => 409', async () => {
    const t = mk({ draft: { status: 'em_elaboracao' } });
    expect(await msg(t.service.registrarCorrecao(t.client, USER, DRAFT, { description: 'x', origin: 'cliente' } as any))).toBeInstanceOf(BadRequestException);
    await t.service.registrarCorrecao(t.client, USER, DRAFT, { description: ' corrigir CNPJ ', origin: 'cliente', requester_label: 'RH da empresa' } as any);
    expect(ins(t.calls)!.params).toEqual([DRAFT, TENANT, V1, 'corrigir CNPJ', 'cliente', 'RH da empresa', USER, USER, null]);
    const f = mk({ draft: { status: 'publicado' } });
    expect(await msg(f.service.registrarCorrecao(f.client, USER, DRAFT, { description: 'x', origin: 'interna' } as any))).toBeInstanceOf(ConflictException);
  });

  it('atualizar: corrigir/cancelar pedem documents.create_draft; verificar/reabrir pedem documents.review', async () => {
    const sem = mk({ socioPerms: ['documents.read'] });
    for (const acao of ['corrigir', 'verificar', 'reabrir', 'cancelar', 'ajustar'])
      expect(await msg(sem.service.atualizarCorrecao(sem.client, USER, DRAFT, CORR, { acao, nota: 'n', prazo: '2026-12-01' } as any))).toBeInstanceOf(ForbiddenException);
    const so = mk({ socioPerms: ['documents.read', 'documents.create_draft'], correcaoStatus: 'corrigida' });
    expect(await msg(so.service.atualizarCorrecao(so.client, USER, DRAFT, CORR, { acao: 'verificar' } as any))).toBeInstanceOf(ForbiddenException);
    expect(so.escritas()).toEqual([]);
  });

  it('atualizar: transições válidas gravam; inválidas (verificar uma aberta, mexer em encerrada) => 409; nota obrigatória; 404', async () => {
    const ok = mk({ correcaoStatus: 'aberta' });
    await ok.service.atualizarCorrecao(ok.client, USER, DRAFT, CORR, { acao: 'corrigir', nota: 'feito' } as any);
    const up = ok.calls.find((c) => /UPDATE document_corrections/.test(c.sql))!;
    expect(up.sql).toContain('status');
    expect(up.params).toEqual(expect.arrayContaining([CORR, 'corrigida', USER, 'feito']));
    const v = mk({ correcaoStatus: 'aberta' });
    expect(await msg(v.service.atualizarCorrecao(v.client, USER, DRAFT, CORR, { acao: 'verificar' } as any))).toBeInstanceOf(ConflictException);
    const enc = mk({ correcaoStatus: 'verificada' });
    expect(await msg(enc.service.atualizarCorrecao(enc.client, USER, DRAFT, CORR, { acao: 'ajustar', prazo: '2026-12-01' } as any))).toBeInstanceOf(ConflictException);
    const r = mk({ correcaoStatus: 'corrigida' });
    expect(await msg(r.service.atualizarCorrecao(r.client, USER, DRAFT, CORR, { acao: 'reabrir' } as any))).toBeInstanceOf(BadRequestException);
    const nf = mk({ correcaoStatus: null });
    expect(await msg(nf.service.atualizarCorrecao(nf.client, USER, DRAFT, CORR, { acao: 'corrigir' } as any))).toBeInstanceOf(NotFoundException);
  });

  it('o detalhe traz a lista de correções e a contagem de pendentes (aberta + corrigida)', async () => {
    const t = mk({ correcoes: [{ id: 'a', status: 'aberta' }, { id: 'b', status: 'corrigida' }, { id: 'c', status: 'verificada' }] });
    const d = await t.service.obter(t.client, USER, DRAFT);
    expect(d.correcoes).toHaveLength(3);
    expect(d.correcoes_pendentes).toBe(2);
  });
});
