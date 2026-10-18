import { readFileSync } from 'fs';
import { join } from 'path';
import { AREAS, CATEGORIAS_POR_AREA } from '../src/normative/normative-rule-areas';

// Só o SQL executável conta: os comentários citam "tenant_id"/"RLS"/"DEFAULT" para dizer que NÃO existem.
const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0074_normative_rules_previdenciario.sql'), 'utf8').replace(/--.*$/gm, '');

const valores = (s: string) => s.split(',').map((v) => v.trim().replace(/'/g, ''));

// As listas vêm do TypeScript (fonte usada pelos DTOs, pelo service e pelo importador): divergência TS × CHECK quebra o teste.
describe('migration 0074 — área previdenciario em normative_rules', () => {
  it('é aditiva: nada destrutivo além de trocar os dois CHECKs (area e coerência) na mesma migration', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER|DEFAULT|NOT\s+NULL)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    const drops = sql.match(/\bDROP\s+CONSTRAINT\s+\w+/gi) ?? [];
    expect(drops).toEqual(['DROP CONSTRAINT normative_rules_area_check', 'DROP CONSTRAINT normative_rules_area_categoria_coerente']);
    // Cada CHECK removido volta com o MESMO nome, depois do DROP.
    for (const nome of ['normative_rules_area_check', 'normative_rules_area_categoria_coerente']) {
      const iDrop = sql.search(new RegExp(`DROP CONSTRAINT ${nome}\\s*;`));
      const iAdd = sql.search(new RegExp(`ADD CONSTRAINT ${nome} CHECK`));
      expect(iDrop).toBeGreaterThan(-1);
      expect(iAdd).toBeGreaterThan(iDrop);
    }
  });

  it('não abre/fecha transação própria (o runner e o psql --single-transaction cuidam disso)', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });

  it('conhecimento global: sem tenant_id e sem RLS', () => {
    expect(sql).not.toMatch(/tenant_id/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY/i);
  });

  it('não mexe na coluna area (NOT NULL, sem DEFAULT, como deixou a 0073)', () => {
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
  });

  // A 0075 acrescentou 'saude_ocupacional' (teste em normative-rules-saude-ocupacional-migration): aqui só o histórico
  // da 0074 — as três áreas dela são um prefixo de AREAS e seus ramos continuam iguais aos do TypeScript.
  it('CHECK de área da 0074 (lip, gro_pgr, previdenciario) é um prefixo de AREAS do TypeScript', () => {
    const m = sql.match(/ADD CONSTRAINT normative_rules_area_check CHECK \(area IN \(([^)]*)\)\)\s*;/);
    expect(m).not.toBeNull();
    expect(valores(m![1])).toEqual(['lip', 'gro_pgr', 'previdenciario']);
    expect([...AREAS].slice(0, 3)).toEqual(['lip', 'gro_pgr', 'previdenciario']);
  });

  it('CHECK de coerência area × categoria da 0074 bate com CATEGORIAS_POR_AREA para as TRÊS áreas dela', () => {
    const chk = sql.match(/ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK \(([\s\S]*?)\)\s*;/);
    expect(chk).not.toBeNull();
    const corpo = chk![1];
    const ramos = [...corpo.matchAll(/area = '(\w+)' AND categoria IN \(([^)]*)\)/g)];
    // Um ramo por área, nenhuma área a mais nem a menos.
    expect(ramos.map((r) => r[1])).toEqual([...AREAS].slice(0, 3));
    for (const [, area, lista] of ramos) {
      expect(valores(lista)).toEqual([...(CATEGORIAS_POR_AREA as Record<string, readonly string[]>)[area]]);
    }
  });

  it('previdenciario aceita SÓ as 7 categorias previdenciárias; lip e gro_pgr ficam como na 0073', () => {
    expect([...CATEGORIAS_POR_AREA.previdenciario]).toEqual([
      'aposentadoria_especial',
      'ltcat',
      'ppp',
      'agentes_nocivos',
      'esocial',
      'cruzamento_documental',
      'exposicao',
    ]);
    // Os conjuntos lip e gro_pgr da 0074 têm de ser idênticos aos da 0073 (a 0073 não é editada).
    const sql0073 = readFileSync(join(__dirname, '..', 'db', 'migrations', '0073_normative_rules_generalization.sql'), 'utf8').replace(/--.*$/gm, '');
    const chk73 = sql0073.match(/ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK \(([\s\S]*?)\)\s*;/)![1];
    const chk74 = sql.match(/ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK \(([\s\S]*?)\)\s*;/)![1];
    for (const area of ['lip', 'gro_pgr']) {
      const re = new RegExp(`area = '${area}' AND categoria IN \\(([^)]*)\\)`);
      expect(valores(chk74.match(re)![1])).toEqual(valores(chk73.match(re)![1]));
    }
    expect(CATEGORIAS_POR_AREA.gro_pgr).toContain('estrutura_pgr');
  });

  it('guarda DO $$ falha cedo se a 0073 não foi aplicada ou se a 0074 já foi aplicada', () => {
    const guarda = sql.match(/DO \$\$[\s\S]*?\$\$;/);
    expect(guarda).not.toBeNull();
    const g = guarda![0];
    // 0073 ausente: normative_rules não existe.
    expect(g).toMatch(/to_regclass\('public\.normative_rules'\) IS NULL/);
    // 0074 já aplicada: o CHECK de área já aceita 'previdenciario' (lido do catálogo).
    expect(g).toMatch(/pg_get_constraintdef/);
    expect(g).toMatch(/normative_rules_area_check/);
    expect(g).toMatch(/previdenciario/);
    const msgs = g.match(/RAISE EXCEPTION '0074: [^']+'/g) ?? [];
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs.join('\n')).toMatch(/0073/);
    expect(msgs.join('\n')).toMatch(/já/);
    // A guarda vem antes de qualquer ALTER.
    expect(sql.indexOf('DO $$')).toBeLessThan(sql.search(/ALTER TABLE/));
  });
});
