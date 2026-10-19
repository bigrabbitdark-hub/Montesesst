import { describe, expect, it } from 'vitest';
import { FIELD_LABELS as HISTORY_LABELS } from '../employees-history';
import { FIELD_LABELS, reasonLabel, statusMessage, type Extraction } from '../employees-ingestion';

const base: Extraction = {
  id: 'x1', tenant_id: 't1', document_id: 'd1', status: 'aplicado',
  summary: { applied: 0, unchanged: 0, novo: 0, conflito: 0, invalida: 0, ignored_rows: 0 },
  items: [], created_at: '2026-10-14T10:00:00Z', resolved_at: null,
};
const ext = (over: Partial<Extraction>, summary = {}): Extraction => ({
  ...base, ...over, summary: { ...base.summary, ...summary },
});

describe('statusMessage', () => {
  it('aplicado, com pluralização e linhas com problema', () => {
    expect(statusMessage(ext({}, { applied: 3, unchanged: 1 }))).toBe('3 funcionários atualizados, 1 sem mudança.');
    expect(statusMessage(ext({}, { applied: 1, unchanged: 0 }))).toBe('1 funcionário atualizado, 0 sem mudança.');
    expect(statusMessage(ext({}, { applied: 2, unchanged: 0, invalida: 1 }))).toBe(
      '2 funcionários atualizados, 0 sem mudança. 1 linha com problema.',
    );
    expect(statusMessage(ext({}, { applied: 2, unchanged: 0, invalida: 3 }))).toContain('3 linhas com problema.');
  });
  it('requer_revisao soma novos e conflitos', () => {
    expect(statusMessage(ext({ status: 'requer_revisao' }, { novo: 2, conflito: 3 }))).toBe('Há 5 itens para revisar.');
    expect(statusMessage(ext({ status: 'requer_revisao' }, { novo: 1 }))).toBe('Há 1 item para revisar.');
  });
  it('sem_dados, ilegivel (com e sem detalhe) e erro', () => {
    expect(statusMessage(ext({ status: 'sem_dados' }))).toBe('Nenhuma linha de funcionário encontrada na planilha.');
    expect(statusMessage(ext({ status: 'ilegivel' }))).toBe('Não foi possível ler a planilha. Use o modelo oficial (.xlsx).');
    expect(statusMessage(ext({ status: 'ilegivel' }, { detail: 'Cabeçalho não reconhecido.' }))).toBe('Cabeçalho não reconhecido.');
    expect(statusMessage(ext({ status: 'erro' }))).toBe('Falha ao processar a planilha. Tente novamente.');
  });
  it('planilha reaproveitada tem prioridade', () => {
    expect(statusMessage(ext({ status: 'requer_revisao', reused: true }, { novo: 1 }))).toBe(
      'Esta planilha já foi enviada e está aguardando revisão.',
    );
  });
});

describe('statusMessage para PDF/DOCX', () => {
  const AI = 'Leitura feita com apoio de IA: confira cada valor antes de aplicar.';
  const sug = { line: 3, kind: 'sugestao' as const, suggestions: [{ field: 'position', proposed: 'Soldador' }] };
  it('revisão de texto avisa que nada foi alterado e conta sugestões', () => {
    const e = ext({ status: 'requer_revisao', items: [sug, { line: 1, kind: 'novo' }, { line: 2, kind: 'invalida' }] }, { method: 'texto', novo: 1 });
    expect(statusMessage(e)).toBe('Há 2 itens para revisar. Nada foi alterado no cadastro ainda.');
    expect(statusMessage(ext({ status: 'requer_revisao', items: [sug] }, { method: 'texto' }))).toBe('Há 1 item para revisar. Nada foi alterado no cadastro ainda.');
  });
  it('texto+ia acrescenta o aviso de IA e, se parcial, o de cobertura', () => {
    const e = ext({ status: 'requer_revisao', items: [sug] }, { method: 'texto+ia', ai_used: true });
    expect(statusMessage(e)).toBe(`Há 1 item para revisar. Nada foi alterado no cadastro ainda. ${AI}`);
    expect(statusMessage(ext({ status: 'requer_revisao', items: [sug] }, { method: 'texto+ia', ai_used: true, ai_partial: true }))).toContain(
      'A IA cobriu só parte do documento',
    );
  });
  it('detail estático para ilegivel, sem_dados e erro; frases padrão sem detail', () => {
    expect(statusMessage(ext({ status: 'ilegivel' }, { method: 'texto', detail: 'PDF sem texto (escaneado).' }))).toBe('PDF sem texto (escaneado).');
    expect(statusMessage(ext({ status: 'sem_dados' }, { method: 'texto', detail: 'Documento com dados de saúde ocupacional não é lido para o cadastro.' }))).toBe(
      'Documento com dados de saúde ocupacional não é lido para o cadastro.',
    );
    expect(statusMessage(ext({ status: 'erro' }, { method: 'texto', detail: 'Muitos documentos em leitura agora. Reenvie em alguns instantes.' }))).toBe(
      'Muitos documentos em leitura agora. Reenvie em alguns instantes.',
    );
    expect(statusMessage(ext({ status: 'sem_dados' }, { method: 'texto' }))).toBe('Nenhum funcionário foi identificado no documento.');
    expect(statusMessage(ext({ status: 'erro' }, { method: 'texto' }))).toBe('Não foi possível ler o documento agora. Tente novamente em instantes.');
  });
  it('planilha mantém as frases da Fatia 3', () => {
    expect(statusMessage(ext({ status: 'requer_revisao' }, { method: 'planilha', novo: 2 }))).toBe('Há 2 itens para revisar.');
  });
});

describe('reused e processando', () => {
  it('reused+processando não fala em planilha', () => {
    const m = 'Este documento ainda está sendo lido. Vamos avisar quando terminar.';
    expect(statusMessage(ext({ status: 'processando', reused: true }))).toBe(m);
    expect(statusMessage(ext({ status: 'processando', reused: true }, { method: 'texto' }))).toBe(m);
  });
  it('reused+requer_revisao: documento para PDF/DOCX, planilha para xlsx', () => {
    expect(statusMessage(ext({ status: 'requer_revisao', reused: true }, { method: 'texto+ia' }))).toBe('Este documento já foi enviado e está aguardando revisão.');
    expect(statusMessage(ext({ status: 'requer_revisao', reused: true }, { method: 'planilha' }))).toBe('Esta planilha já foi enviada e está aguardando revisão.');
  });
  it('não lança com items/summary degenerados', () => {
    expect(() => statusMessage({ ...ext({ status: 'requer_revisao' }), items: undefined as never, summary: undefined as never })).not.toThrow();
  });
});

describe('expirado e IA não usada', () => {
  it('expirado usa o detail ou a frase padrão (mesmo com reused)', () => {
    expect(statusMessage(ext({ status: 'expirado' }, { method: 'texto', detail: 'A revisão expirou. Reenvie o documento.' }))).toBe('A revisão expirou. Reenvie o documento.');
    expect(statusMessage(ext({ status: 'expirado', reused: true }))).toBe('A revisão expirou. Reenvie o documento.');
  });
  it('ai_used=false com ai_attempted=true: sem aviso de IA e com o detail estático', () => {
    const m = statusMessage(ext({ status: 'requer_revisao', items: [{ line: 1, kind: 'novo' }] }, { method: 'texto', ai_used: false, ai_attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' }));
    expect(m).not.toContain('apoio de IA');
    expect(m).toContain('Leitura por IA indisponível; o documento foi lido sem IA.');
  });
});

describe('reasonLabel e FIELD_LABELS', () => {
  it('traduz o motivo conhecido e tem fallback', () => {
    expect(reasonLabel('outra_filial')).toBe('Já cadastrado em outra filial');
    expect(reasonLabel(undefined)).toBe('Linha com problema');
    expect(reasonLabel('qualquer coisa')).toBe('qualquer coisa');
  });
  it('reexporta os rótulos do histórico', () => {
    expect(FIELD_LABELS).toBe(HISTORY_LABELS);
  });
});
