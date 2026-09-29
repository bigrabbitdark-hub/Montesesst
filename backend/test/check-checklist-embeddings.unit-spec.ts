import { describeChecklistEmbeddingHealth } from '../db/check-checklist-embeddings';

// ITEM 010 da auditoria do Assistente (2026-09-28): o embedding dos 301
// itens do checklist interno (`sst_checklist_items`) depende de um script
// manual pós-migration (`db:embed-sst-checklist`) sem nenhum alerta se for
// esquecido — os itens ficam com `embedding IS NULL` e somem em silêncio
// da busca (`WHERE embedding IS NOT NULL`). Este módulo é só a lógica pura
// de decisão (sem banco), pra rodar em segundos e ser fácil de manter.
describe('describeChecklistEmbeddingHealth (unit)', () => {
  it('total zero é falha: a tabela deveria ter os 301 itens da migration 0049', () => {
    const result = describeChecklistEmbeddingHealth(0, 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('0 itens');
  });

  it('todos com embedding é saudável', () => {
    const result = describeChecklistEmbeddingHealth(301, 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('301');
  });

  it('qualquer item sem embedding é falha, mesmo que seja só 1 de muitos', () => {
    const result = describeChecklistEmbeddingHealth(301, 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1 de 301');
  });

  it('todos sem embedding (script nunca rodou) é falha', () => {
    const result = describeChecklistEmbeddingHealth(301, 301);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('301 de 301');
  });
});
