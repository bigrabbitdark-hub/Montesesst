import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MatrizService } from '../src/atuacao/pgr/matriz/matriz.service';
import { AvaliacoesService } from '../src/atuacao/pgr/matriz/avaliacoes.service';
import { sha256Canonico } from '../src/atuacao/pgr/matriz/matriz-config';
import { AtualizarMatrizDto, CriarAvaliacaoDto, CriarMatrizDto, MapaCalorQueryDto, PublicarMatrizDto, ValidarMatrizDto } from '../src/atuacao/pgr/matriz/dto/matriz.dto';
import { RiscosService } from '../src/atuacao/pgr/riscos.service';

// Unitário dos serviços da matriz/avaliações (PGR B1, Task 3) com cliente pg falso. Config de TESTE, sem valor normativo.
type Q = { sql: string; params: unknown[] };
function fakeClient(handlers: Array<[RegExp, (p: unknown[]) => { rows: any[]; rowCount?: number } | Error]>) {
  const calls: Q[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [re, h] of handlers) {
        if (re.test(sql)) {
          const r = h(params);
          if (r instanceof Error) throw r;
          return r;
        }
      }
      return { rows: [] };
    }),
  };
  return { client, calls };
}
const admin = { id: 'u-admin', role: 'admin' };
const socio = { id: 'u-socio', role: 'socio' };
const ctx = { role: 'admin', method: 'POST', path: '/atuacao/pgr/matriz', ip: '1.1.1.1' };
const V = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const audits = (calls: Q[]) => calls.filter((c) => /INSERT INTO audit_log/.test(c.sql));
const writes = (calls: Q[]) => calls.filter((c) => /^\s*(INSERT INTO pgr_|UPDATE pgr_|DELETE FROM pgr_)/.test(c.sql));
const erros = (cls: any, obj: object) => validateSync(plainToInstance(cls, obj), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

const CFG = () => ({
  severidade: [{ valor: 1, rotulo: 'TESTE s1', descricao: 'd' }, { valor: 2, rotulo: 'TESTE s2', descricao: 'd' }, { valor: 3, rotulo: 'TESTE s3', descricao: 'd' }],
  probabilidade: [{ valor: 1, rotulo: 'TESTE p1', descricao: 'd' }, { valor: 2, rotulo: 'TESTE p2', descricao: 'd' }, { valor: 3, rotulo: 'TESTE p3', descricao: 'd' }],
  niveis: [
    { id: 'n1', rotulo: 'TESTE nivel 1', aceitabilidade: 'a', decisao: 'd', bloqueia_emissao: false },
    { id: 'n2', rotulo: 'TESTE nivel 2', aceitabilidade: 'a', decisao: 'd', bloqueia_emissao: true },
  ],
  faixas: [{ min: 1, max: 3, nivel_id: 'n1' }, { min: 4, max: 9, nivel_id: 'n2' }],
  metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE', data: '2026-01-01' },
});

describe('MatrizService', () => {
  const svc = new MatrizService();

  it('papel diferente de admin ⇒ 403 em criar/atualizar/publicar/arquivar, sem consultar o banco', async () => {
    const { client, calls } = fakeClient([]);
    await expect(svc.criar(client, socio, {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.atualizar(client, socio, V, { notes: 'x' }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.publicar(client, socio, V, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.arquivar(client, socio, V, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toHaveLength(0);
  });

  it('criar: trava (advisory) antes de calcular max+1; vazia vira config {}; audita só ids', async () => {
    const { client, calls } = fakeClient([
      [/COALESCE\(MAX\(version_number\)/, () => ({ rows: [{ n: 7 }] })],
      [/INSERT INTO pgr_matrix_versions/, () => ({ rows: [{ id: V }] })],
      [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, version_number: 7, status: 'rascunho', config: {} }] })],
    ]);
    const r: any = await svc.criar(client, admin, { notes: 'TESTE nota' }, ctx);
    const iLock = calls.findIndex((c) => /pg_advisory_xact_lock/.test(c.sql));
    const iMax = calls.findIndex((c) => /MAX\(version_number\)/.test(c.sql));
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(iLock).toBeLessThan(iMax);
    const ins = calls.find((c) => /INSERT INTO pgr_matrix_versions/.test(c.sql))!;
    expect(ins.params).toContain(7);
    expect(ins.params).toContain(JSON.stringify({}));
    expect(audits(calls)).toHaveLength(1);
    expect(audits(calls)[0].params).toContain('pgr.matrix.created');
    expect(JSON.stringify(audits(calls)[0].params)).not.toContain('TESTE nota');
    expect(r.validacao.pode_publicar).toBe(false);
  });

  it('criar: copiar_de + config ⇒ 400; origem inexistente ⇒ 404; config > 200000 bytes ⇒ 400; nada gravado', async () => {
    const a = fakeClient([]);
    await expect(svc.criar(a.client, admin, { copiar_de: V, config: {} }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    const b = fakeClient([]);
    await expect(svc.criar(b.client, admin, { copiar_de: V }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    const c = fakeClient([]);
    await expect(svc.criar(c.client, admin, { config: { x: 'a'.repeat(200001) } }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    for (const x of [a, b, c]) expect(writes(x.calls)).toHaveLength(0);
  });

  it('atualizar: versão não rascunho ⇒ 409; inexistente ⇒ 404; corpo vazio/config nulo ⇒ 400; sem gravação', async () => {
    const pub = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'publicada', version_number: 1, config: CFG() }] })]]);
    await expect(svc.atualizar(pub.client, admin, V, { config: {} }, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(writes(pub.calls)).toHaveLength(0);
    const nao = fakeClient([]);
    await expect(svc.atualizar(nao.client, admin, V, { notes: 'x' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    const a = fakeClient([]);
    await expect(svc.atualizar(a.client, admin, V, {}, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.atualizar(a.client, admin, V, { config: null }, ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('atualizar: guarda config incompleto e devolve erros/pendências como avisos (não rejeita)', async () => {
    const rasc = { id: V, status: 'rascunho', version_number: 2, config: {} };
    const { client, calls } = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [rasc] })]]);
    const r: any = await svc.atualizar(client, admin, V, { config: { severidade: [] } }, ctx);
    expect(calls.some((c) => /UPDATE pgr_matrix_versions SET/.test(c.sql))).toBe(true);
    expect(r.validacao.erros.length).toBeGreaterThan(0);
    expect(r.validacao.pode_publicar).toBe(false);
    expect(audits(calls)[0].params).toContain('pgr.matrix.updated');
  });

  it('publicar: config inválido ⇒ 400 com erros/pendências, nada gravado nem auditado', async () => {
    const { client, calls } = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'rascunho', version_number: 1, config: { severidade: [] } }] })]]);
    const e: any = await svc.publicar(client, admin, V, ctx).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getResponse().erros.length).toBeGreaterThan(0);
    expect(Array.isArray(e.getResponse().pendencias)).toBe(true);
    expect(writes(calls)).toHaveLength(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it('publicar: já publicada ⇒ 409; válido ⇒ UPDATE com sha256Canonico e published_by; audita', async () => {
    const pub = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'publicada', version_number: 1, config: CFG() }] })]]);
    await expect(svc.publicar(pub.client, admin, V, ctx)).rejects.toBeInstanceOf(ConflictException);
    const cfg = CFG();
    const { client, calls } = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'rascunho', version_number: 3, config: cfg }] })]]);
    await svc.publicar(client, admin, V, ctx);
    const up = calls.find((c) => /UPDATE pgr_matrix_versions SET/.test(c.sql))!;
    expect(up.params).toContain(sha256Canonico(cfg));
    expect(up.params).toContain('u-admin');
    expect(audits(calls)[0].params).toContain('pgr.matrix.published');
  });

  it('publicar: existindo publicada com número maior ⇒ 409 em pt-BR, sem gravar', async () => {
    const { client, calls } = fakeClient([
      [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'rascunho', version_number: 3, config: CFG() }] })],
      [/status = 'publicada' AND version_number >/, () => ({ rows: [{ '?column?': 1 }] })],
    ]);
    const e: any = await svc.publicar(client, admin, V, ctx).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toBe('Existe uma versão publicada mais nova; crie uma nova versão a partir desta (copiar_de).');
    expect(writes(calls)).toHaveLength(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it('publicar com updated_at: rascunho alterado desde a leitura ⇒ 409; mesmo instante ⇒ publica', async () => {
    const lido = new Date('2026-10-28T10:00:00.123Z');
    const row = { id: V, status: 'rascunho', version_number: 3, config: CFG(), updated_at: new Date('2026-10-28T10:05:00.000Z') };
    const a = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [row] })]]);
    const e: any = await svc.publicar(a.client, admin, V, ctx, { updated_at: lido.toISOString() }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/foi alterado desde que você o abriu/);
    expect(writes(a.calls)).toHaveLength(0);
    const b = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ ...row, updated_at: lido }] })]]);
    await svc.publicar(b.client, admin, V, ctx, { updated_at: lido.toISOString() });
    expect(b.calls.some((c) => /UPDATE pgr_matrix_versions SET status = 'publicada'/.test(c.sql))).toBe(true);
    expect(erros(PublicarMatrizDto, { updated_at: 'ontem' })).toContain('updated_at');
    expect(erros(PublicarMatrizDto, { updated_at: lido.toISOString() })).toEqual([]);
    expect(erros(PublicarMatrizDto, { sha: 'x' })).toContain('sha');
  });

  it('criar/publicar usam o advisory lock por hash de texto (hashtextextended)', async () => {
    const a = fakeClient([[/COALESCE\(MAX/, () => ({ rows: [{ n: 1 }] })], [/INSERT INTO pgr_matrix_versions/, () => ({ rows: [{ id: V }] })], [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, version_number: 1, config: {} }] })]]);
    await svc.criar(a.client, admin, {}, ctx);
    const b = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status: 'rascunho', version_number: 1, config: CFG() }] })]]);
    await svc.publicar(b.client, admin, V, ctx);
    for (const x of [a, b]) expect(x.calls.find((c) => /pg_advisory_xact_lock/.test(c.sql))!.sql).toMatch(/hashtextextended\('pgr_matrix_versions:numero', 0\)/);
  });

  it('arquivar: só publicada (rascunho/arquivada ⇒ 409)', async () => {
    for (const status of ['rascunho', 'arquivada']) {
      const { client, calls } = fakeClient([[/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [{ id: V, status, version_number: 1, config: CFG() }] })]]);
      await expect(svc.arquivar(client, admin, V, ctx)).rejects.toBeInstanceOf(ConflictException);
      expect(writes(calls)).toHaveLength(0);
    }
  });

  it('validar: stateless, sem consulta; devolve erros, pendências e células quando sem erros', () => {
    const ok: any = svc.validar({ config: CFG(), publicar: true });
    expect(ok.ok).toBe(true);
    expect(ok.celulas).toHaveLength(9);
    const ruim: any = svc.validar({ config: { severidade: [] } });
    expect(ruim.ok).toBe(false);
    expect(ruim.celulas).toBeNull();
  });

  it('DTOs: config não objeto, extras e tipos', () => {
    expect(erros(CriarMatrizDto, { config: 'x' })).toContain('config');
    expect(erros(CriarMatrizDto, { config: [] })).toContain('config');
    expect(erros(CriarMatrizDto, { copiar_de: 'nao-uuid' })).toContain('copiar_de');
    expect(erros(AtualizarMatrizDto, { config: 5 })).toContain('config');
    expect(erros(AtualizarMatrizDto, { status: 'publicada' })).toContain('status');
    expect(erros(ValidarMatrizDto, {})).toContain('config');
    expect(erros(ValidarMatrizDto, { config: {}, publicar: 'sim' })).toContain('publicar');
    expect(erros(MapaCalorQueryDto, { kind: 'x' })).toContain('kind');
  });
});

describe('AvaliacoesService', () => {
  const svc = new AvaliacoesService();
  const empresaOk: [RegExp, () => { rows: any[] }] = [/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [{ id: T }] })];
  const riscoOk: [RegExp, () => { rows: any[] }] = [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, ghe_id: 'g' }] })];
  const vigente = (status = 'publicada') => ({ id: V, version_number: 4, status, config: CFG() });
  const matrizVigente: [RegExp, () => { rows: any[] }] = [/FROM pgr_matrix_versions\s+WHERE status = 'publicada'/, () => ({ rows: [vigente()] })];
  const dto = (extra: object = {}) => plainToInstance(CriarAvaliacaoDto, { kind: 'inerente', severity_value: 2, probability_value: 3, justification: '  TESTE motivo secreto  ', ...extra });

  it('empresa invisível ⇒ 404 e nada gravado; papel indevido ⇒ 403', async () => {
    const a = fakeClient([[/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [] })]]);
    await expect(svc.criar(a.client, socio, T, R, dto(), ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(a.calls)).toHaveLength(0);
    const b = fakeClient([]);
    await expect(svc.criar(b.client, { id: 'x', role: 'tecnico' }, T, R, dto(), ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.calls).toHaveLength(0);
  });

  it('risco de outro tenant ⇒ 404', async () => {
    const { client, calls } = fakeClient([empresaOk]);
    await expect(svc.criar(client, socio, T, R, dto(), ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('sem matriz publicada e sem versão informada ⇒ 409 com a mensagem de espera', async () => {
    const { client, calls } = fakeClient([empresaOk, riscoOk]);
    const e: any = await svc.criar(client, socio, T, R, dto(), ctx).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toBe('Aguardando matriz publicada pela equipe técnica.');
    expect(writes(calls)).toHaveLength(0);
  });

  it('versão informada inexistente/arquivada/rascunho ⇒ 400', async () => {
    const nao = fakeClient([empresaOk, riscoOk]);
    await expect(svc.criar(nao.client, socio, T, R, dto({ matrix_version_id: V }), ctx)).rejects.toBeInstanceOf(BadRequestException);
    for (const status of ['arquivada', 'rascunho']) {
      const { client, calls } = fakeClient([empresaOk, riscoOk, [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [vigente(status)] })]]);
      await expect(svc.criar(client, socio, T, R, dto({ matrix_version_id: V }), ctx)).rejects.toBeInstanceOf(BadRequestException);
      expect(writes(calls)).toHaveLength(0);
    }
  });

  it('valores fora da escala ⇒ 400 com mensagem precisa e nada gravado', async () => {
    const { client, calls } = fakeClient([empresaOk, riscoOk, matrizVigente]);
    const e: any = await svc.criar(client, socio, T, R, dto({ severity_value: 9 }), ctx).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/Severidade 9 fora da escala/);
    expect(writes(calls)).toHaveLength(0);
  });

  it('cria: score/nível calculados no servidor, justificativa gravada, audita só ids (sem a justificativa)', async () => {
    const { client, calls } = fakeClient([
      empresaOk, riscoOk, matrizVigente,
      [/INSERT INTO pgr_risk_assessments/, () => ({ rows: [{ id: 'a1', score: 6, level_id: 'n2', matrix_version_id: V }] })],
    ]);
    const r: any = await svc.criar(client, socio, T, R, dto(), ctx);
    const ins = calls.find((c) => /INSERT INTO pgr_risk_assessments/.test(c.sql))!;
    expect(ins.params).toEqual(expect.arrayContaining([6, 'n2', V, 'TESTE motivo secreto']));
    expect(r.nivel.id).toBe('n2');
    expect(r.nivel.bloqueia_emissao).toBe(true);
    const a = audits(calls);
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('pgr.assessment.created');
    expect(JSON.stringify(a[0].params)).not.toContain('secreto');
  });

  it('I1: versão informada publicada mas NÃO vigente ⇒ 409 (recarregue a vigente); vigente informada ⇒ grava', async () => {
    const antiga = { id: V, version_number: 1, status: 'publicada', config: CFG() };
    const nova = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', version_number: 2, status: 'publicada', config: CFG() };
    const base = [empresaOk, riscoOk, [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [antiga] })] as any,
      [/WHERE status = 'publicada' ORDER BY version_number DESC LIMIT 1/, () => ({ rows: [nova] })] as any];
    const a = fakeClient([...base] as any);
    const e: any = await svc.criar(a.client, socio, T, R, dto({ matrix_version_id: V }), ctx).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/matriz vigente mudou/);
    expect(writes(a.calls)).toHaveLength(0);
    const b = fakeClient([empresaOk, riscoOk, [/FROM pgr_matrix_versions WHERE id = \$1/, () => ({ rows: [nova] })] as any,
      [/WHERE status = 'publicada' ORDER BY version_number DESC LIMIT 1/, () => ({ rows: [nova] })] as any,
      [/INSERT INTO pgr_risk_assessments/, () => ({ rows: [{ id: 'a1' }] })]] as any);
    await svc.criar(b.client, socio, T, R, dto({ matrix_version_id: nova.id }), ctx);
    expect(writes(b.calls)).toHaveLength(1);
  });

  it('M5: resposta ao sócio não traz assessed_by; ao admin traz', async () => {
    const row = { id: 'a1', assessed_by: 'u-x', score: 6 };
    for (const [ator, tem] of [[socio, false], [admin, true]] as const) {
      const { client } = fakeClient([
        empresaOk, riscoOk, matrizVigente,
        [/INSERT INTO pgr_risk_assessments/, () => ({ rows: [{ id: 'a1' }] })],
        [/FROM pgr_risk_assessments a JOIN pgr_matrix_versions v/, () => ({ rows: [row] })],
      ]);
      const r: any = await svc.criar(client, ator, T, R, dto(), ctx);
      expect('assessed_by' in r).toBe(tem);
    }
    const { client } = fakeClient([empresaOk, [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R }] })],
      [/FROM pgr_risk_assessments a JOIN/, () => ({ rows: [{ kind: 'inerente', assessed_by: 'u-x' }] })]]);
    const l: any = await svc.listar(client, socio, T, R);
    expect(l.historico[0]).not.toHaveProperty('assessed_by');
    expect(l.vigente.inerente).not.toHaveProperty('assessed_by');
  });

  it('DTO: score/nível enviados pelo cliente, justificativa em branco/longa, valores inválidos ⇒ rejeitados', () => {
    const base = { kind: 'inerente', severity_value: 2, probability_value: 3, justification: 'TESTE' };
    expect(erros(CriarAvaliacaoDto, base)).toEqual([]);
    expect(erros(CriarAvaliacaoDto, { ...base, score: 1 })).toContain('score');
    expect(erros(CriarAvaliacaoDto, { ...base, level_id: 'n1' })).toContain('level_id');
    expect(erros(CriarAvaliacaoDto, { ...base, justification: '   ' })).toContain('justification');
    expect(erros(CriarAvaliacaoDto, { ...base, justification: 'x'.repeat(4001) })).toContain('justification');
    expect(erros(CriarAvaliacaoDto, { ...base, kind: 'outro' })).toContain('kind');
    expect(erros(CriarAvaliacaoDto, { ...base, severity_value: 1.5 })).toContain('severity_value');
    expect(erros(CriarAvaliacaoDto, { ...base, probability_value: 0 })).toContain('probability_value');
  });
});

describe('RiscosService.excluir com avaliações', () => {
  it('trigger de histórico (23514) ⇒ 409 em pt-BR e sem auditoria', async () => {
    const svc = new RiscosService();
    const err: any = new Error('risco com avaliações registradas não pode ser apagado (histórico da matriz é append-only)');
    err.code = '23514';
    const { client, calls } = fakeClient([
      [/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [{ id: T }] })],
      [/SELECT \* FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/, () => ({ rows: [{ id: R, ghe_id: 'g' }] })],
      [/DELETE FROM pgr_risks/, () => err],
    ]);
    const e: any = await svc.excluir(client, socio, T, R, ctx).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/avaliações/);
    expect(audits(calls)).toHaveLength(0);
  });
});
