import { describe, it, expect } from 'vitest';
import { nivelScore, seloDoStatus, paraItensLista, paraVencimentos, hojeISO } from '../real';
import type { ApiAttentionItem } from '../api-types';

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
