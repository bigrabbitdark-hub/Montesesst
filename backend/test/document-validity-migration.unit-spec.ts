import { readFileSync } from 'fs';
import { join } from 'path';

// Só o SQL executável conta (comentários mencionam RLS/DROP/UPDATE só para explicar).
const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0079_document_validity.sql'), 'utf8').replace(/--.*$/gm, '');

describe('migration 0079 — validade de documentos', () => {
  it('colunas novas em documents são opcionais (sem NOT NULL/DEFAULT)', () => {
    for (const c of ['valid_from DATE', 'expires_source TEXT', 'validity_months_applied INT']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS ${c};`));
    }
  });

  it('CHECKs de expires_source e de coerência valid_from <= expires_at', () => {
    expect(sql).toMatch(/expires_source IN \('manual', 'rule'\)/);
    expect(sql).toMatch(/valid_from IS NULL OR expires_at IS NULL OR expires_at >= valid_from/);
  });

  it('não altera expires_at nem a policy, e não é destrutiva em documents', () => {
    expect(sql).not.toMatch(/\bUPDATE\s+documents\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/documents_isolation|POLICY/i);
    expect(sql).not.toMatch(/ALTER COLUMN expires_at/i);
  });

  it('tabela global: sem tenant_id e sem RLS (padrão 0013/0006)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS document_validity_rules/);
    expect(sql).not.toMatch(/tenant_id/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('limites e FK de usuário nullable', () => {
    expect(sql).toMatch(/validity_months BETWEEN 1 AND 600/);
    expect(sql).toMatch(/alert_days INT NOT NULL DEFAULT 30 CHECK \(alert_days BETWEEN 0 AND 365\)/);
    expect(sql).toMatch(/updated_by_user_id UUID REFERENCES users\(id\)/);
  });

  it('seed: 12 categorias, pcmso=12, pgr=24, demais NULL, alert 30, ON CONFLICT DO NOTHING', () => {
    const seed = sql.slice(sql.indexOf('INSERT INTO document_validity_rules'));
    const rows = [...seed.matchAll(/\('([a-z_]+)', (NULL|\d+), (\d+)\)/g)].map((m) => [m[1], m[2], m[3]]);
    expect(rows).toHaveLength(12);
    const byCat = Object.fromEntries(rows.map((r) => [r[0], r[1]]));
    expect(byCat.pcmso).toBe('12');
    expect(byCat.pgr).toBe('24');
    for (const [cat, months] of Object.entries(byCat)) {
      if (cat !== 'pcmso' && cat !== 'pgr') expect(months).toBe('NULL');
    }
    expect(rows.every((r) => r[2] === '30')).toBe(true);
    expect(seed).toMatch(/ON CONFLICT \(category\) DO NOTHING/);
  });

  it('as 12 categorias do seed são as do CHECK de documents (0046)', () => {
    const doc = readFileSync(join(__dirname, '..', 'db', 'migrations', '0046_relatorio_visita_category.sql'), 'utf8').replace(/--.*$/gm, '');
    const cats = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const checkBlock = sql.slice(sql.indexOf('category TEXT PRIMARY KEY'), sql.indexOf('validity_months INT'));
    expect(cats(checkBlock)).toEqual(cats(doc.slice(doc.indexOf('category IN'))));
  });
});
