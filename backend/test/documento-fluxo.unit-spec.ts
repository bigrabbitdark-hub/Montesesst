import { readFileSync } from 'fs';
import { join } from 'path';
import * as fluxo from '../src/atuacao/documentos/documento-fluxo';
import {
  AVISO_ASSINATURA_INTERNA,
  DOC_ACOES,
  DOC_STATUS,
  DocStatus,
  MSG_ACAO_NAO_HABILITADA,
  avaliarAcao,
  estadoAposNovaVersao,
  transicaoDocPermitida,
} from '../src/atuacao/documentos/documento-fluxo';
import { PERMISSIONS } from '../src/common/permissions';

const VALIDAS: Record<string, string[]> = {
  em_elaboracao: ['em_revisao', 'cancelado'],
  em_revisao: ['aprovado', 'em_elaboracao', 'cancelado'],
  aprovado: ['assinado', 'em_elaboracao', 'cancelado'],
  assinado: ['publicado', 'em_elaboracao', 'cancelado'],
  publicado: [],
  cancelado: [],
};

describe('documento-fluxo: transições', () => {
  it('tabela completa (inclusive mesmo estado e terminais)', () => {
    for (const de of DOC_STATUS) {
      for (const para of DOC_STATUS) {
        expect({ de, para, ok: transicaoDocPermitida(de, para) }).toEqual({
          de,
          para,
          ok: VALIDAS[de].includes(para),
        });
      }
    }
  });

  it('é idêntica ao trigger da migration 0096', () => {
    const sql = readFileSync(join(__dirname, '../db/migrations/0096_documentos_fluxo.sql'), 'utf8');
    const ini = sql.indexOf('guard_document_drafts_update()');
    const trecho = sql.slice(ini, sql.indexOf('transição de status inválida', ini));
    const re = /OLD\.status = '(\w+)'\s+AND NEW\.status IN \(([^)]*)\)/g;
    const doSql: Record<string, string[]> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(trecho))) {
      doSql[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    }
    expect(Object.keys(doSql).length).toBe(4);
    for (const de of DOC_STATUS) {
      const doCodigo = DOC_STATUS.filter((p) => transicaoDocPermitida(de, p)).sort();
      expect(doCodigo).toEqual(doSql[de] ?? []);
    }
    expect(sql).toMatch(/OLD\.status IN \('publicado', 'cancelado'\)/);
  });
});

const ESTADO_OK: Record<string, DocStatus[]> = {
  elaborar: ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado'],
  revisar: ['em_revisao'],
  aprovar: ['em_revisao'],
  assinar: ['aprovado'],
  publicar: ['assinado'],
};

describe('documento-fluxo: avaliarAcao', () => {
  const base = { elaboradoresIds: ['autor'], usuarioId: 'outro', temPermissaoMatriz: true, registroConfirmado: true };

  it('cada ação em cada estado', () => {
    for (const acao of DOC_ACOES) {
      for (const draftStatus of DOC_STATUS) {
        const r = avaliarAcao({ ...base, acao, draftStatus });
        if (ESTADO_OK[acao].includes(draftStatus)) expect(r).toEqual({ ok: true });
        else expect(r).toMatchObject({ ok: false, codigo: 'ESTADO' });
      }
    }
  });

  it('estado vem antes da matriz', () => {
    expect(avaliarAcao({ ...base, acao: 'publicar', draftStatus: 'em_elaboracao', temPermissaoMatriz: false })).toMatchObject({ codigo: 'ESTADO' });
  });

  it('matriz ausente => MATRIZ com a mensagem exata, mesmo no estado certo', () => {
    for (const acao of DOC_ACOES) {
      const draftStatus = ESTADO_OK[acao][0];
      expect(avaliarAcao({ ...base, acao, draftStatus, temPermissaoMatriz: false })).toEqual({
        ok: false,
        codigo: 'MATRIZ',
        mensagem: MSG_ACAO_NAO_HABILITADA,
      });
    }
  });

  it('autor revisando a própria versão => SEPARACAO', () => {
    const r = avaliarAcao({ ...base, acao: 'revisar', draftStatus: 'em_revisao', usuarioId: 'autor' });
    expect(r).toMatchObject({ ok: false, codigo: 'SEPARACAO' });
  });

  it('elaborador aprovando => SEPARACAO (revisor e aprovador diferentes do elaborador, por padrão)', () => {
    expect(avaliarAcao({ ...base, acao: 'aprovar', draftStatus: 'em_revisao', usuarioId: 'autor' })).toMatchObject({ ok: false, codigo: 'SEPARACAO' });
    expect(avaliarAcao({ ...base, acao: 'aprovar', draftStatus: 'em_revisao', usuarioId: 'terceiro' })).toEqual({ ok: true });
  });

  it('todos os elaboradores contam (vários), não só um', () => {
    const b = { ...base, elaboradoresIds: ['criador', 'autor-v1', 'quem-submeteu'], draftStatus: 'em_revisao' as const };
    for (const u of ['criador', 'autor-v1', 'quem-submeteu']) {
      expect(avaliarAcao({ ...b, acao: 'revisar', usuarioId: u })).toMatchObject({ codigo: 'SEPARACAO' });
      expect(avaliarAcao({ ...b, acao: 'aprovar', usuarioId: u })).toMatchObject({ codigo: 'SEPARACAO' });
    }
    expect(avaliarAcao({ ...b, acao: 'revisar', usuarioId: 'outro' })).toEqual({ ok: true });
  });

  it('matriz vem antes da separação; elaborar, assinar e publicar não sofrem separação (nem aprovador≠signatário≠publicador)', () => {
    expect(avaliarAcao({ ...base, acao: 'revisar', draftStatus: 'em_revisao', usuarioId: 'autor', temPermissaoMatriz: false })).toMatchObject({ codigo: 'MATRIZ' });
    expect(avaliarAcao({ ...base, acao: 'aprovar', draftStatus: 'em_revisao', usuarioId: 'autor', temPermissaoMatriz: false })).toMatchObject({ codigo: 'MATRIZ' });
    expect(avaliarAcao({ ...base, acao: 'assinar', draftStatus: 'aprovado', usuarioId: 'autor' })).toEqual({ ok: true });
    expect(avaliarAcao({ ...base, acao: 'elaborar', draftStatus: 'em_elaboracao', usuarioId: 'autor' })).toEqual({ ok: true });
    expect(avaliarAcao({ ...base, acao: 'publicar', draftStatus: 'assinado', usuarioId: 'autor' })).toEqual({ ok: true });
    // a MESMA pessoa (não elaboradora) aprova, assina e publica quando a matriz permite
    const mesma = { ...base, usuarioId: 'terceiro' };
    expect(avaliarAcao({ ...mesma, acao: 'aprovar', draftStatus: 'em_revisao' })).toEqual({ ok: true });
    expect(avaliarAcao({ ...mesma, acao: 'assinar', draftStatus: 'aprovado' })).toEqual({ ok: true });
    expect(avaliarAcao({ ...mesma, acao: 'publicar', draftStatus: 'assinado' })).toEqual({ ok: true });
  });

  it('SEPARACAO_PADRAO exportado com os dois bloqueios ligados', () => {
    expect(fluxo.SEPARACAO_PADRAO).toEqual({ revisorDiferenteDoElaborador: true, aprovadorDiferenteDoElaborador: true });
  });

  it('assinar sem registro confirmado => REGISTRO', () => {
    for (const registroConfirmado of [false, undefined]) {
      expect(avaliarAcao({ ...base, acao: 'assinar', draftStatus: 'aprovado', registroConfirmado })).toEqual({
        ok: false,
        codigo: 'REGISTRO',
        mensagem: 'Registro profissional não confirmado.',
      });
    }
    expect(avaliarAcao({ ...base, acao: 'aprovar', draftStatus: 'em_revisao', registroConfirmado: false })).toEqual({ ok: true });
  });

  it('mensagem de ESTADO e SEPARACAO são textos não vazios', () => {
    const e = avaliarAcao({ ...base, acao: 'assinar', draftStatus: 'publicado' });
    expect(e.ok === false && e.mensagem.length > 0).toBe(true);
    const s = avaliarAcao({ ...base, acao: 'revisar', draftStatus: 'em_revisao', usuarioId: 'autor' });
    expect(s.ok === false && s.mensagem.length > 0).toBe(true);
  });
});

describe('documento-fluxo: estadoAposNovaVersao', () => {
  it('volta a em_elaboracao', () => {
    for (const s of ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado'] as const) {
      expect(estadoAposNovaVersao(s)).toBe('em_elaboracao');
    }
  });
  it('rejeita publicado/cancelado', () => {
    expect(() => estadoAposNovaVersao('publicado')).toThrow();
    expect(() => estadoAposNovaVersao('cancelado')).toThrow();
  });
});

describe('documento-fluxo: textos e permissões', () => {
  it('constantes exatas', () => {
    expect(AVISO_ASSINATURA_INTERNA).toBe(
      'Registro de assinatura interna do sistema. Não é certificado digital ICP-Brasil e não garante, por si só, validade jurídica em todos os casos.',
    );
    expect(AVISO_ASSINATURA_INTERNA.toLowerCase()).toContain('não é certificado digital icp-brasil');
    expect(MSG_ACAO_NAO_HABILITADA).toBe(
      'Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades.',
    );
  });

  it('nenhum outro texto exportado cita "assinatura digital" ou "ICP-Brasil"', () => {
    const textos: string[] = [];
    const coleta = (v: unknown) => {
      if (typeof v === 'string') textos.push(v);
      else if (Array.isArray(v)) v.forEach(coleta);
      else if (v && typeof v === 'object') Object.values(v).forEach(coleta);
    };
    for (const [k, v] of Object.entries(fluxo)) if (k !== 'AVISO_ASSINATURA_INTERNA' && typeof v !== 'function') coleta(v);
    // mensagens produzidas pelas funções
    for (const acao of DOC_ACOES) for (const draftStatus of DOC_STATUS) for (const usuarioId of ['a', 'b']) for (const t of [true, false]) {
      const r = avaliarAcao({ acao, draftStatus, elaboradoresIds: ['a'], usuarioId, temPermissaoMatriz: t });
      if (!r.ok) textos.push(r.mensagem);
    }
    for (const s of DOC_STATUS) { try { estadoAposNovaVersao(s); } catch (e) { textos.push(String((e as Error).message)); } }
    for (const t of textos) {
      expect(t.toLowerCase()).not.toContain('assinatura digital');
      expect(t).not.toContain('ICP-Brasil');
    }
  });

  it('PERMISSIONS: 14 itens (12 anteriores + documents.cancel + documents.view_registration), sem permissões proibidas', () => {
    const p = PERMISSIONS as readonly string[];
    expect(p).toHaveLength(14);
    for (const x of ['documents.read', 'documents.approve', 'documents.publish', 'documents.cancel', 'documents.view_registration']) expect(p).toContain(x);
    for (const x of ['finance.write', 'billing.manage', 'users.manage', 'settings.manage']) expect(p).not.toContain(x);
  });
});

describe('documento-fluxo: PERMISSIONS x CHECK de socio_permissions na migration 0096', () => {
  it('a lista do CHECK do banco e a lista TS concordam', () => {
    const sql = readFileSync(join(__dirname, '../db/migrations/0096_documentos_fluxo.sql'), 'utf8');
    const ini = sql.indexOf('ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (');
    expect(ini).toBeGreaterThan(0);
    const trecho = sql.slice(ini, sql.indexOf('));', ini));
    const doBanco = [...trecho.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual([...(PERMISSIONS as readonly string[])].sort());
  });
});

describe('documento-fluxo: cancelamento conservador', () => {
  const m = (...a: string[]) => new Set(a);
  it('em_elaboracao/em_revisao: basta elaborar', () => {
    for (const s of ['em_elaboracao', 'em_revisao'] as DocStatus[]) {
      expect(fluxo.avaliarCancelamento({ draftStatus: s, matriz: m('elaborar') })).toEqual({ ok: true });
      expect(fluxo.avaliarCancelamento({ draftStatus: s, matriz: m('aprovar', 'assinar') })).toMatchObject({ ok: false, codigo: 'MATRIZ', mensagem: MSG_ACAO_NAO_HABILITADA });
    }
  });
  it('aprovado exige elaborar E aprovar; assinado exige elaborar E assinar', () => {
    expect(fluxo.avaliarCancelamento({ draftStatus: 'aprovado', matriz: m('elaborar') })).toMatchObject({ ok: false, codigo: 'MATRIZ' });
    expect(fluxo.avaliarCancelamento({ draftStatus: 'aprovado', matriz: m('aprovar') })).toMatchObject({ ok: false, codigo: 'MATRIZ' });
    expect(fluxo.avaliarCancelamento({ draftStatus: 'aprovado', matriz: m('elaborar', 'aprovar') })).toEqual({ ok: true });
    expect(fluxo.avaliarCancelamento({ draftStatus: 'assinado', matriz: m('elaborar', 'aprovar') })).toMatchObject({ ok: false, codigo: 'MATRIZ' });
    expect(fluxo.avaliarCancelamento({ draftStatus: 'assinado', matriz: m('elaborar', 'assinar') })).toEqual({ ok: true });
  });
  it('publicado e cancelado: ESTADO, mesmo com tudo na matriz', () => {
    for (const s of ['publicado', 'cancelado'] as DocStatus[]) {
      expect(fluxo.avaliarCancelamento({ draftStatus: s, matriz: m(...DOC_ACOES) })).toMatchObject({ ok: false, codigo: 'ESTADO' });
    }
  });
});

describe('avaliarViabilidade (função pura)', () => {
  const SEP = fluxo.SEPARACAO_PADRAO;
  const av = (matriz: { userId: string; acoes: fluxo.DocAcao[] }[], conf: string[] = [], separacao: any = SEP) =>
    fluxo.avaliarViabilidade({ matriz, registrosConfirmados: new Set(conf), separacao });
  const TODAS = [...DOC_ACOES] as fluxo.DocAcao[];

  it('matriz vazia (ou só pessoas sem ação) => nao_configurada, sem faltas', () => {
    expect(av([])).toEqual({ status: 'nao_configurada', faltas: [], avisos: [] });
    expect(av([{ userId: 'a', acoes: [] }])).toMatchObject({ status: 'nao_configurada' });
  });
  it('só elaborar => inviável com faltas de aprovar, assinar e publicar', () => {
    const r = av([{ userId: 'a', acoes: ['elaborar'] }], ['a']);
    expect(r.status).toBe('inviavel');
    expect(r.faltas).toEqual(expect.arrayContaining([
      'Ninguém habilitado a aprovar.', 'Ninguém habilitado a assinar.', 'Ninguém habilitado a publicar.',
    ]));
    expect(r.faltas.join(' ')).not.toMatch(/elaborar/);
  });
  it('mesma única pessoa elabora e aprova => inviável por separação; com duas pessoas => viável', () => {
    const um = av([{ userId: 'a', acoes: TODAS }], ['a']);
    expect(um.status).toBe('inviavel');
    expect(um.faltas).toContain('O único aprovador é também o único elaborador, e o aprovador não pode ser o elaborador.');
    const dois = av([{ userId: 'a', acoes: ['elaborar'] }, { userId: 'b', acoes: ['aprovar', 'assinar', 'publicar'] }], ['b']);
    expect(dois).toMatchObject({ status: 'viavel', faltas: [] });
  });
  it('um elaborador e um aprovador diferentes em conjuntos maiores basta (existe par a≠e)', () => {
    const r = av([{ userId: 'a', acoes: ['elaborar', 'aprovar', 'assinar', 'publicar'] }, { userId: 'b', acoes: ['aprovar'] }], ['a']);
    expect(r.status).toBe('viavel');
  });
  it('assinar sem registro confirmado => inviável; com registro confirmado => viável', () => {
    const m = [{ userId: 'a', acoes: ['elaborar'] as fluxo.DocAcao[] }, { userId: 'b', acoes: ['aprovar', 'assinar', 'publicar'] as fluxo.DocAcao[] }];
    const sem = av(m, ['a']);
    expect(sem.status).toBe('inviavel');
    expect(sem.faltas).toEqual(['Ninguém habilitado a assinar com registro profissional confirmado.']);
    expect(av(m, ['b']).status).toBe('viavel');
  });
  it('separacao.aprovadorDiferenteDoElaborador=false => a mesma pessoa serve', () => {
    const r = av([{ userId: 'a', acoes: TODAS }], ['a'], { revisorDiferenteDoElaborador: true, aprovadorDiferenteDoElaborador: false });
    expect(r.status).toBe('viavel');
  });
  it('aviso de devolver quando não há revisor diferente do elaborador (não impede)', () => {
    const base = [{ userId: 'a', acoes: ['elaborar', 'revisar'] as fluxo.DocAcao[] }, { userId: 'b', acoes: ['aprovar', 'assinar', 'publicar'] as fluxo.DocAcao[] }];
    const r = av(base, ['b']);
    expect(r.status).toBe('viavel');
    expect(r.avisos).toEqual(['Ninguém além do elaborador pode revisar: "devolver à elaboração" ficará indisponível.']);
    const ok = av([...base, { userId: 'c', acoes: ['revisar'] }], ['b']);
    expect(ok.avisos).toEqual([]);
  });
  it('registro pendente/revogado não conta como confirmado (só o conjunto informado conta)', () => {
    const m = [{ userId: 'a', acoes: ['elaborar'] as fluxo.DocAcao[] }, { userId: 'b', acoes: ['aprovar', 'assinar', 'publicar'] as fluxo.DocAcao[] }];
    expect(av(m, []).status).toBe('inviavel');
  });
});
