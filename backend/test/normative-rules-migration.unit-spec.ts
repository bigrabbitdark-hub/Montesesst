import { readFileSync } from 'fs';
import { join } from 'path';
import { AREAS, CATEGORIAS_POR_AREA } from '../src/normative/normative-rule-areas';

// Só o SQL executável conta: os comentários da migration citam os nomes antigos e "tenant_id"/"RLS" para dizer que NÃO existem.
const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0073_normative_rules_generalization.sql'), 'utf8').replace(/--.*$/gm, '');

// As listas vêm do TypeScript (fonte usada pelos DTOs e pelo service): divergência TS × CHECK do SQL quebra o teste.
const GRO: readonly string[] = CATEGORIAS_POR_AREA.gro_pgr;
const LIP: readonly string[] = CATEGORIAS_POR_AREA.lip;

describe('migration 0073 — generalização lip_* → normative_*', () => {
  it('é aditiva: nada destrutivo (RENAME é permitido; DROP só do CHECK antigo de categoria)', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b/i);
    const drops = sql.match(/\bDROP\s+CONSTRAINT\s+\w+/gi) ?? [];
    expect(drops).toEqual(['DROP CONSTRAINT lip_rules_categoria_check']);
  });

  it('não abre/fecha transação própria (o runner e o psql --single-transaction cuidam disso)', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });

  it('conhecimento global: sem tenant_id e sem RLS', () => {
    expect(sql).not.toMatch(/tenant_id/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('renomeia as duas tabelas', () => {
    expect(sql).toMatch(/ALTER TABLE lip_rules RENAME TO normative_rules\s*;/);
    expect(sql).toMatch(/ALTER TABLE lip_rule_provisions RENAME TO normative_rule_provisions\s*;/);
  });

  it('renomeia todas as constraints e índices nomeados/implícitos da 0072', () => {
    const constraints: [string, string, string][] = [
      ['normative_rules', 'lip_rules_pkey', 'normative_rules_pkey'],
      ['normative_rules', 'lip_rules_rule_key_key', 'normative_rules_rule_key_key'],
      ['normative_rules', 'lip_rules_metodo_avaliacao_check', 'normative_rules_metodo_avaliacao_check'],
      ['normative_rules', 'lip_rules_status_check', 'normative_rules_status_check'],
      ['normative_rules', 'lip_rules_reviewed_by_user_id_fkey', 'normative_rules_reviewed_by_user_id_fkey'],
      ['normative_rules', 'lip_rules_vigencia', 'normative_rules_vigencia'],
      ['normative_rules', 'lip_rules_revisada_exige_revisor', 'normative_rules_revisada_exige_revisor'],
      ['normative_rule_provisions', 'lip_rule_provisions_pkey', 'normative_rule_provisions_pkey'],
      ['normative_rule_provisions', 'lip_rule_provisions_rule_id_fkey', 'normative_rule_provisions_rule_id_fkey'],
      ['normative_rule_provisions', 'lip_rule_provisions_provision_id_fkey', 'normative_rule_provisions_provision_id_fkey'],
      ['normative_rule_provisions', 'lip_rule_provisions_papel_check', 'normative_rule_provisions_papel_check'],
    ];
    for (const [tabela, de, para] of constraints) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${tabela} RENAME CONSTRAINT ${de} TO ${para}\\s*;`));
    }
    expect(sql).toMatch(/ALTER INDEX lip_rules_categoria_status_idx RENAME TO normative_rules_categoria_status_idx\s*;/);
    expect(sql).toMatch(/ALTER INDEX lip_rule_provisions_provision_idx RENAME TO normative_rule_provisions_provision_idx\s*;/);
  });

  it('recria o CORPO da função do trigger com os nomes novos ANTES de renomear função e trigger', () => {
    const corpo = sql.match(/CREATE OR REPLACE FUNCTION lip_rules_require_active_provision\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/);
    expect(corpo).not.toBeNull();
    expect(corpo![0]).toMatch(/FROM normative_rule_provisions rp/);
    expect(corpo![0]).toMatch(/JOIN normative_provisions p/);
    expect(corpo![0]).not.toMatch(/lip_rule_provisions|FROM lip_rules/);
    expect(corpo![0]).toMatch(/dispositivo literal ativo/);
    const iCorpo = sql.indexOf('CREATE OR REPLACE FUNCTION');
    const iFn = sql.search(/ALTER FUNCTION lip_rules_require_active_provision\(\) RENAME TO normative_rules_require_active_provision\s*;/);
    const iTrg = sql.search(/ALTER TRIGGER lip_rules_require_active_provision ON normative_rules RENAME TO normative_rules_require_active_provision\s*;/);
    expect(iFn).toBeGreaterThan(iCorpo);
    expect(iTrg).toBeGreaterThan(-1);
  });

  it('acrescenta area NOT NULL com DEFAULT só para preencher linhas existentes, e remove o DEFAULT logo depois', () => {
    expect(sql).toMatch(/ADD COLUMN area text NOT NULL DEFAULT 'lip'/);
    const iAdd = sql.search(/ADD COLUMN area text NOT NULL DEFAULT 'lip'/);
    const iDrop = sql.search(/ALTER TABLE normative_rules ALTER COLUMN area DROP DEFAULT\s*;/);
    // Sem DEFAULT, INSERT sem `area` falha (NOT NULL): a área de toda regra nova é explícita.
    expect(iDrop).toBeGreaterThan(iAdd);
  });

  it('CHECK de área da 0073 (lip, gro_pgr) é um prefixo de AREAS do TypeScript', () => {
    const m = sql.match(/CONSTRAINT normative_rules_area_check CHECK \(area IN \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    // A 0074 acrescentou 'previdenciario' (teste em normative-rules-previdenciario-migration): aqui só o histórico da 0073.
    expect(m![1].split(',').map((v) => v.trim().replace(/'/g, ''))).toEqual(['lip', 'gro_pgr']);
    expect([...AREAS].slice(0, 2)).toEqual(['lip', 'gro_pgr']);
  });

  it('categoria: CHECK antigo substituído por CHECK de coerência area × categoria com todos os valores', () => {
    const chk = sql.match(/ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK \(([\s\S]*?)\)\s*;/);
    expect(chk).not.toBeNull();
    const corpo = chk![1];
    const lip = corpo.match(/area = 'lip' AND categoria IN \(([^)]*)\)/);
    const gro = corpo.match(/area = 'gro_pgr' AND categoria IN \(([^)]*)\)/);
    expect(lip).not.toBeNull();
    expect(gro).not.toBeNull();
    const valores = (s: string) => s.split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(valores(lip![1])).toEqual([...LIP]);
    expect(valores(gro![1])).toEqual([...GRO]);
    expect(GRO).toContain('estrutura_pgr');
    // O CHECK antigo é removido na MESMA migration em que o novo entra.
    expect(sql.indexOf('DROP CONSTRAINT lip_rules_categoria_check')).toBeGreaterThan(-1);
  });

  it('falha cedo, com mensagem clara, se o estado do banco não for o esperado (guarda DO $$)', () => {
    expect(sql).toMatch(/DO \$\$[\s\S]*RAISE EXCEPTION[\s\S]*\$\$;/);
    expect(sql).toMatch(/to_regclass\('public\.lip_rules'\)/);
    expect(sql).toMatch(/to_regclass\('public\.normative_rules'\)/);
  });
});
