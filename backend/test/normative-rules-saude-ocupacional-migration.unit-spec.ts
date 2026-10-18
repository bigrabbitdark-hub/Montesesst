import { readFileSync } from 'fs';
import { join } from 'path';
import { AREAS, CATEGORIAS_POR_AREA } from '../src/normative/normative-rule-areas';

// Só o SQL executável conta: os comentários citam "tenant_id"/"RLS"/"DEFAULT" para dizer que NÃO existem.
const semComentarios = (arquivo: string) =>
  readFileSync(join(__dirname, '..', 'db', 'migrations', arquivo), 'utf8').replace(/--.*$/gm, '');
const sql = semComentarios('0075_normative_rules_saude_ocupacional.sql');
const sql0074 = semComentarios('0074_normative_rules_previdenciario.sql');

const valores = (s: string) => s.split(',').map((v) => v.trim().replace(/'/g, ''));
const checkCoerencia = (s: string) => s.match(/ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK \(([\s\S]*?)\)\s*;/)![1];
const ramo = (corpo: string, area: string) => {
  const m = corpo.match(new RegExp(`area = '${area}' AND categoria IN \\(([^)]*)\\)`));
  return m ? valores(m[1]) : null;
};

const SAUDE = ['pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude'];

// As listas vêm do TypeScript (fonte usada pelos DTOs, pelo service e pelo importador): divergência TS × CHECK quebra o teste.
describe('migration 0075 — área saude_ocupacional em normative_rules', () => {
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

  it('CHECK de área bate com AREAS do TypeScript (lip, gro_pgr, previdenciario, saude_ocupacional)', () => {
    const m = sql.match(/ADD CONSTRAINT normative_rules_area_check CHECK \(area IN \(([^)]*)\)\)\s*;/);
    expect(m).not.toBeNull();
    expect(valores(m![1])).toEqual([...AREAS]);
    expect([...AREAS]).toEqual(['lip', 'gro_pgr', 'previdenciario', 'saude_ocupacional']);
  });

  it('CHECK de coerência area × categoria bate com CATEGORIAS_POR_AREA para as QUATRO áreas', () => {
    const corpo = checkCoerencia(sql);
    const ramos = [...corpo.matchAll(/area = '(\w+)' AND categoria IN \(([^)]*)\)/g)];
    // Um ramo por área, nenhuma área a mais nem a menos, na ordem de AREAS.
    expect(ramos.map((r) => r[1])).toEqual([...AREAS]);
    expect(ramos).toHaveLength(4);
    for (const [, area, lista] of ramos) {
      expect(valores(lista)).toEqual([...(CATEGORIAS_POR_AREA as Record<string, readonly string[]>)[area]]);
    }
  });

  it('saude_ocupacional aceita SÓ as 7 categorias de saúde ocupacional', () => {
    expect([...CATEGORIAS_POR_AREA.saude_ocupacional]).toEqual(SAUDE);
    expect(ramo(checkCoerencia(sql), 'saude_ocupacional')).toEqual(SAUDE);
  });

  it('lip, gro_pgr e previdenciario ficam EXATAMENTE como na 0074 (a 0074 não é editada)', () => {
    for (const area of ['lip', 'gro_pgr', 'previdenciario']) {
      const de74 = ramo(checkCoerencia(sql0074), area);
      expect(de74).not.toBeNull();
      expect(ramo(checkCoerencia(sql), area)).toEqual(de74);
      expect([...(CATEGORIAS_POR_AREA as Record<string, readonly string[]>)[area]]).toEqual(de74);
    }
  });

  it('categorias exclusivas de saude_ocupacional não vazam para outras áreas; a área não é categoria de ninguém', () => {
    // 'excecao' já é categoria de gro_pgr desde a 0073 (compartilhada de propósito); as outras 6 são novas.
    const novas = SAUDE.filter((c) => c !== 'excecao');
    const corpo = checkCoerencia(sql);
    for (const area of ['lip', 'gro_pgr', 'previdenciario'] as const) {
      const lista = ramo(corpo, area)!;
      for (const c of novas) {
        expect(lista).not.toContain(c);
        expect(CATEGORIAS_POR_AREA[area] as readonly string[]).not.toContain(c);
      }
    }
    for (const area of AREAS) {
      expect(CATEGORIAS_POR_AREA[area] as readonly string[]).not.toContain('saude_ocupacional');
      expect(ramo(corpo, area)).not.toContain('saude_ocupacional');
    }
    // saude_ocupacional aparece no SQL executável só no CHECK de área, no ramo de coerência e na guarda.
    const fora = sql.replace(/DO \$\$[\s\S]*?\$\$;/, '').match(/saude_ocupacional/g) ?? [];
    expect(fora).toHaveLength(2);
  });

  it('guarda DO $$ falha cedo se a 0074 não foi aplicada ou se a 0075 já foi aplicada', () => {
    const guarda = sql.match(/DO \$\$[\s\S]*?\$\$;/);
    expect(guarda).not.toBeNull();
    const g = guarda![0];
    // Tabela ausente.
    expect(g).toMatch(/to_regclass\('public\.normative_rules'\) IS NULL/);
    // Só o CHECK de ÁREA é lido do catálogo ('previdenciario' também é categoria lip no CHECK de coerência).
    expect(g).toMatch(/pg_get_constraintdef/);
    expect(g).toMatch(/conname = 'normative_rules_area_check'/);
    // 0074 ausente: o CHECK de área ainda não aceita 'previdenciario'.
    expect(g).toMatch(/NOT LIKE '%previdenciario%'/);
    // 0075 já aplicada: o CHECK de área já aceita 'saude_ocupacional'.
    expect(g).toMatch(/LIKE '%saude_ocupacional%'/);
    // Nenhum LIKE da guarda olha o texto do CHECK de coerência.
    for (const l of g.match(/(\w+)\s+(NOT\s+)?LIKE/g) ?? []) expect(l).toMatch(/^def_area\b/);
    const msgs = g.match(/RAISE EXCEPTION '0075: [^']+'/g) ?? [];
    expect(msgs.length).toBeGreaterThanOrEqual(4);
    const todas = msgs.join('\n');
    expect(todas).toMatch(/aplique a 0074/);
    expect(todas).toMatch(/já/);
    // A guarda vem antes de qualquer ALTER.
    expect(sql.indexOf('DO $$')).toBeLessThan(sql.search(/ALTER TABLE/));
  });
});
