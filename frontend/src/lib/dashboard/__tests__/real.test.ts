import { describe, it, expect } from 'vitest';
import { nivelScore, seloDoStatus, paraItensLista, paraVencimentos, hojeISO, paraNrLinhas, lerNrs } from '../real';
import type { ApiAttentionItem } from '../api-types';
import type { ApiNrItem } from '../api-types';

const item = (over: Partial<ApiAttentionItem>): ApiAttentionItem => ({
  tipo: 'documento',
  titulo: 'Documento vencido: PGR',
  prioridade: 'alta',
  data: '2026-10-15',
  responsavel: 'empresa',
  link: '/empresa/documentos',
  ...over,
});

describe('nivelScore', () => {
  it.each([
    [null, 'Sem dados'], [100, 'Excelente'], [90, 'Excelente'], [89, 'Bom'], [80, 'Bom'],
    [79, 'Atenção'], [60, 'Atenção'], [59, 'Crítico'], [0, 'Crítico'],
  ])('%s → %s', (score, nivel) => expect(nivelScore(score)).toBe(nivel));
});

describe('seloDoStatus (regra do backend)', () => {
  it('ok → Conforme', () => expect(seloDoStatus('ok')).toEqual({ tone: 'ok', texto: 'Conforme' }));
  it('atencao → com ressalvas', () => expect(seloDoStatus('atencao').texto).toBe('Conforme, com ressalvas'));
  it('critico → Pendências críticas', () => expect(seloDoStatus('critico')).toEqual({ tone: 'crit', texto: 'Pendências críticas' }));
});

describe('paraItensLista', () => {
  it('mapeia prioridade para rótulo em texto e formata a data', () => {
    const [a, b] = paraItensLista([item({}), item({ prioridade: 'media', data: null, responsavel: 'tecnico' })]);
    expect(a).toMatchObject({ rotulo: 'Urgente', tone: 'crit', detalhe: 'Sua empresa · 15/10/2026', href: '/empresa/documentos' });
    expect(b).toMatchObject({ rotulo: 'A vencer', tone: 'warn', detalhe: 'Técnico' });
  });
  it('ids únicos mesmo com itens iguais', () => {
    const ids = paraItensLista([item({}), item({})]).map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
  it('lista vazia', () => expect(paraItensLista([])).toEqual([]));
});

describe('paraVencimentos', () => {
  it('descarta itens sem data e ordena pela data, vencidos primeiro', () => {
    const r = paraVencimentos([
      item({ titulo: 'B', data: '2026-11-01' }),
      item({ titulo: 'sem data', data: null }),
      item({ titulo: 'A', data: '2026-09-20' }),
    ]);
    expect(r.map((v) => v.nome)).toEqual(['A', 'B']);
  });
});

describe('hojeISO', () => {
  it('usa a data local com zeros à esquerda', () => expect(hojeISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05'));
});

describe('paraNrLinhas', () => {
  const base = { nome: 'PCMSO', fonte_oficial_url: 'https://www.gov.br/x' };
  it('mapeia status para rótulo em texto e tom', () => {
    const itens: ApiNrItem[] = [
      { ...base, code: 'NR-1', status: 'em_dia', evidencia: { quantidade: 2, proxima_validade: '2027-03-01' } },
      { ...base, code: 'NR-6', status: 'atencao', evidencia: { quantidade: 1, proxima_validade: '2026-10-20' } },
      { ...base, code: 'NR-7', status: 'pendente', evidencia: { quantidade: 0, proxima_validade: null } },
    ];
    const linhas = paraNrLinhas(itens);
    expect(linhas.map((l) => [l.code, l.rotulo, l.tone])).toEqual([
      ['NR-1', 'Em dia', 'ok'],
      ['NR-6', 'Atenção', 'warn'],
      ['NR-7', 'Pendente', 'crit'],
    ]);
  });
  it('detalhe usa "evidências cadastradas" e a próxima validade formatada', () => {
    const [a, b, c] = paraNrLinhas([
      { ...base, code: 'NR-1', status: 'em_dia', evidencia: { quantidade: 2, proxima_validade: '2027-03-01' } },
      { ...base, code: 'NR-5', status: 'em_dia', evidencia: { quantidade: 1, proxima_validade: null } },
      { ...base, code: 'NR-7', status: 'pendente', evidencia: { quantidade: 0, proxima_validade: null } },
    ]);
    expect(a.detalhe).toBe('2 evidências cadastradas · próxima validade 01/03/2027');
    expect(b.detalhe).toBe('1 evidência cadastrada');
    expect(c.detalhe).toBe('Nenhuma evidência cadastrada');
  });
  it('nao_avaliavel mostra a mensagem do backend e não inventa número', () => {
    const [l] = paraNrLinhas([{ ...base, code: 'NR-23', status: 'nao_avaliavel', evidencia: null, mensagem: 'Não foi possível calcular agora.' }]);
    expect(l.rotulo).toBe('Não avaliável');
    expect(l.tone).toBe('info');
    expect(l.detalhe).toBe('Não foi possível calcular agora.');
  });
  it('status desconhecido cai em "Não avaliável"/info sem lançar', () => {
    const itens = [{ ...base, code: 'NR-9', status: 'foo', evidencia: null }] as unknown as ApiNrItem[];
    let linhas: ReturnType<typeof paraNrLinhas> = [];
    expect(() => { linhas = paraNrLinhas(itens); }).not.toThrow();
    expect(linhas[0].rotulo).toBe('Não avaliável');
    expect(linhas[0].tone).toBe('info');
  });
  it('evidencia ausente (undefined) é tratada como null', () => {
    const semMsg = [{ ...base, code: 'NR-9', status: 'nao_avaliavel' }] as unknown as ApiNrItem[];
    const comMsg = [{ ...base, code: 'NR-9', status: 'nao_avaliavel', mensagem: 'Indisponível.' }] as unknown as ApiNrItem[];
    expect(paraNrLinhas(semMsg)[0].detalhe).toBe('Sem dados para avaliar.');
    expect(paraNrLinhas(comMsg)[0].detalhe).toBe('Indisponível.');
  });
});

describe('lerNrs', () => {
  const resp = (over: object) => over as unknown as Response;
  const itens: ApiNrItem[] = [
    { code: 'NR-1', nome: 'PGR', status: 'em_dia', evidencia: { quantidade: 1, proxima_validade: null }, fonte_oficial_url: 'https://www.gov.br/x' },
  ];
  it('resposta nula (falha de rede) -> null', async () => {
    expect(await lerNrs(null)).toBeNull();
  });
  it('resposta !ok -> null', async () => {
    expect(await lerNrs(resp({ ok: false, json: async () => ({ nrs: [] }) }))).toBeNull();
  });
  it('ok com { nrs: [] } -> []', async () => {
    expect(await lerNrs(resp({ ok: true, json: async () => ({ nrs: [] }) }))).toEqual([]);
  });
  it('ok com itens -> o mesmo array', async () => {
    expect(await lerNrs(resp({ ok: true, json: async () => ({ nrs: itens }) }))).toEqual(itens);
  });
  it('json() rejeita -> null', async () => {
    expect(await lerNrs(resp({ ok: true, json: async () => { throw new Error('x'); } }))).toBeNull();
  });
  it('corpo sem nrs -> null', async () => {
    expect(await lerNrs(resp({ ok: true, json: async () => ({}) }))).toBeNull();
  });
  it('nrs que não é array -> null', async () => {
    expect(await lerNrs(resp({ ok: true, json: async () => ({ nrs: 'x' }) }))).toBeNull();
  });
});
