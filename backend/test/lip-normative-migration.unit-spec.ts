import { readFileSync } from 'fs';
import { join } from 'path';

// Só o SQL executável conta: os comentários da migration mencionam "tenant_id"/"RLS" justamente para dizer que NÃO existem.
const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0072_lip_normative_base.sql'), 'utf8').replace(/--.*$/gm, '');

describe('migration 0072 — base normativa do LIP', () => {
  it('é aditiva: nada destrutivo', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  it('conhecimento global: sem tenant_id e sem RLS', () => {
    expect(sql).not.toMatch(/tenant_id/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('cria as três tabelas', () => {
    for (const t of ['normative_provisions', 'lip_rules', 'lip_rule_provisions']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${t}\\b`));
    }
  });

  it('regra revisada exige revisor identificado e dispositivo ativo (CHECK + trigger)', () => {
    expect(sql).toMatch(/reviewer_registro/);
    expect(sql).toMatch(/status <> 'revisada'/);
    expect(sql).toMatch(/CREATE TRIGGER lip_rules_require_active_provision/);
  });
});
