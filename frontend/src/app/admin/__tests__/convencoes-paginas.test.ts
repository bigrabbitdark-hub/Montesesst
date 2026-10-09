import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Páginas já migradas para o DS v2 do admin. Cada lote acrescenta as suas aqui.
const PAGINAS = ['empresas/page.tsx', 'auditoria/page.tsx', 'financeiro/page.tsx', 'tecnicos/page.tsx', 'parceiros/page.tsx', 'normativa/page.tsx', 'checklist-sst/page.tsx', 'empresas/[id]/page.tsx', 'normativa/FontesPanel.tsx', 'normativa/DiffView.tsx'];

const BASE = join(process.cwd(), 'src/app/admin');

// admin-theme.css fora de @layer: o que a classe .adm-* define vence o utilitário do Tailwind na mesma
// propriedade. Cada regra lista o que a classe define (alvo) e o utilitário que ficaria sem efeito (proibido).
const REGRAS: { alvo: RegExp; proibido: RegExp; motivo: string }[] = [
  { alvo: /\badm-(card-2|card|input|btn|table)\b/, proibido: /^(rounded(-\S+)?|bg-\S+|border(-\S+)?)$/, motivo: 'rounded/bg/border' },
  { alvo: /\badm-(input|btn|link)\b/, proibido: /^p[xytblr]?-\S+$/, motivo: 'padding' },
  { alvo: /\badm-btn\b/, proibido: /^(text-(xs|sm|base|lg|xl|[2-9]xl)|font-\S+)$/, motivo: 'tamanho/peso da fonte' },
  { alvo: /\badm-(btn|link)\b/, proibido: /^text-(brand|red|green|yellow|white|slate|adm)\S*$/, motivo: 'cor do texto' },
];

// Ignora variantes (sm:, hover:, disabled:…): perdem do mesmo jeito.
const semVariante = (token: string) => token.split(':').pop() ?? token;

function violacoes(classes: string): string[] {
  const tokens = classes.split(/\s+/).filter(Boolean);
  return REGRAS.filter((r) => r.alvo.test(classes)).flatMap((r) =>
    tokens.filter((t) => r.proibido.test(semVariante(t))).map((t) => `${t} (${r.motivo})`),
  );
}

function classNames(fonte: string): string[] {
  return [...fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '');
}

describe('regras de convenção (autoteste)', () => {
  it.each([
    ['adm-btn px-6', 1],
    ['adm-btn sm:text-xs', 1],
    ['adm-btn text-brand-700', 1],
    ['adm-btn font-medium', 1],
    ['adm-input hover:bg-red-500', 1],
    ['adm-input rounded-md', 1],
    ['adm-link text-red-600', 1],
    ['adm-link-danger text-red-600', 1],
    ['adm-link-danger px-2', 1],
    ['adm-card-2 border-brand-100', 1],
    ['adm-card-2 border border-brand-100', 2],
  ])('%s é recusado', (classes, quantidade) => {
    expect(violacoes(classes)).toHaveLength(quantidade);
  });

  it.each([
    'adm-btn adm-btn-primary self-start disabled:opacity-50',
    'adm-btn adm-btn-danger disabled:opacity-50',
    'adm-input w-full min-w-0 text-sm',
    'adm-input sm:col-span-2',
    'adm-card overflow-x-auto p-2 sm:p-4',
    'adm-card-2 flex items-center justify-between px-3 py-2 text-sm',
    'adm-link',
    'adm-link-danger shrink-0 whitespace-nowrap disabled:opacity-50',
    'adm-table',
  ])('%s é aceito', (classes) => {
    expect(violacoes(classes)).toEqual([]);
  });
});

describe.each(PAGINAS)('convenções do DS v2 do admin em %s', (pagina) => {
  const fonte = readFileSync(join(BASE, pagina), 'utf8');
  const lista = classNames(fonte);

  it('não sobra o bloco antigo (borda cinza arredondada) nem o campo antigo', () => {
    expect(fonte).not.toContain('rounded-lg border border-brand-100');
    expect(fonte).not.toContain('rounded-md border border-brand-100');
  });

  it('usa pelo menos um primitivo .adm-* em className literal (senão o teste abaixo seria vazio)', () => {
    expect(lista.some((c) => /\badm-/.test(c))).toBe(true);
  });

  it('nenhum elemento com .adm-* leva utilitário que a classe já define (e que seria ignorado)', () => {
    expect(lista.flatMap((c) => violacoes(c).map((v) => `${v} em "${c}"`))).toEqual([]);
  });
});
