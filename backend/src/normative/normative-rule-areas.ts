// Áreas e categorias das regras interpretativas (tabela normative_rules, migrations 0073, 0074 e 0075).
// Espelha os CHECKs normative_rules_area_check e normative_rules_area_categoria_coerente da migration mais
// recente (0075): alterar aqui exige migration nova, e vice-versa.
// 'previdenciario' é ÁREA (0074: aposentadoria especial, LTCAT, PPP…) e também uma CATEGORIA da área lip
// (0072/0073); são coisas distintas e a categoria lip 'previdenciario' não foi alterada.
// 'saude_ocupacional' (0075: PCMSO, exames, ASO, relatório analítico, LGPD). 'excecao' é categoria de gro_pgr e
// de saude_ocupacional (cada uma no seu ramo do CHECK); as demais categorias de saúde só existem nessa área.
export const AREAS = ['lip', 'gro_pgr', 'previdenciario', 'saude_ocupacional'] as const;
export type RuleArea = (typeof AREAS)[number];

export const CATEGORIAS_POR_AREA = {
  lip: ['insalubridade', 'periculosidade', 'prevencao', 'previdenciario'],
  gro_pgr: ['identificacao_perigos', 'avaliacao_riscos', 'controle_riscos', 'plano_acao', 'inventario', 'revisao', 'excecao', 'psicossocial', 'estrutura_pgr'],
  previdenciario: ['aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao'],
  saude_ocupacional: ['pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude'],
} as const satisfies Record<RuleArea, readonly string[]>;

export type RuleCategoria = (typeof CATEGORIAS_POR_AREA)[RuleArea][number];

// Todas as categorias conhecidas, sem repetição (validação de formato no DTO); a coerência com a área é checada à parte.
export const CATEGORIAS: readonly RuleCategoria[] = [...new Set<RuleCategoria>(AREAS.flatMap((a) => CATEGORIAS_POR_AREA[a]))];

export function isRuleArea(area: unknown): area is RuleArea {
  return typeof area === 'string' && (AREAS as readonly string[]).includes(area);
}

export function categoriaValidaParaArea(area: unknown, categoria: unknown): boolean {
  return isRuleArea(area) && (CATEGORIAS_POR_AREA[area] as readonly string[]).includes(categoria as string);
}
