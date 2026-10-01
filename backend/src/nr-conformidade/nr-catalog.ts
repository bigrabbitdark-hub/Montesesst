// Catálogo de NRs do cartão "Conformidade por NR". Guarda só REFERÊNCIA
// (código, rótulo curto, regra de evidência) — nunca texto normativo. Quem
// decide se uma NR se aplica à empresa é o técnico (company_applicable_nrs);
// este catálogo só diz onde procurar evidência já cadastrada no sistema.
// Catálogo inicial confirmado pelo dono em 2026-10-01. NRs sem evidência
// estruturada (NR-10, 12, 18, 35 etc.) entram só quando houver fonte real.

export type NrStatus = 'em_dia' | 'atencao' | 'pendente' | 'nao_avaliavel';

export type Regra =
  | { fonte: 'documento'; categorias: readonly string[] }
  | { fonte: 'cipa' }
  | { fonte: 'epi' }
  | { fonte: 'equipamento_incendio' };

export interface NrCatalogEntry {
  code: string;
  nome: string; // rótulo curto, não o título oficial completo
  regra: Regra;
  // 'alguma': basta uma evidência vigente. 'todas': qualquer vencida torna a NR pendente.
  agregacao: 'alguma' | 'todas';
}

// URL da página "Normas Regulamentadoras Vigentes" do MTE, indicada pelo dono nos
// anexos (o PDF traz só o texto do link). VERIFICADO em 2026-10-01 (WebFetch: página "Normas Regulamentadoras Vigentes" do MTE, lista as 7 NRs do catálogo).
export const FONTE_OFICIAL_NRS_URL =
  'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes';

export const NR_CATALOG: readonly NrCatalogEntry[] = [
  { code: 'NR-1', nome: 'Disposições gerais e gerenciamento de riscos (PGR)', regra: { fonte: 'documento', categorias: ['pgr'] }, agregacao: 'alguma' },
  { code: 'NR-5', nome: 'CIPA', regra: { fonte: 'cipa' }, agregacao: 'alguma' },
  { code: 'NR-6', nome: 'Equipamento de proteção individual (EPI)', regra: { fonte: 'epi' }, agregacao: 'todas' },
  { code: 'NR-7', nome: 'PCMSO', regra: { fonte: 'documento', categorias: ['pcmso'] }, agregacao: 'alguma' },
  { code: 'NR-15', nome: 'Atividades e operações insalubres', regra: { fonte: 'documento', categorias: ['lip'] }, agregacao: 'alguma' },
  { code: 'NR-16', nome: 'Atividades e operações perigosas', regra: { fonte: 'documento', categorias: ['lip'] }, agregacao: 'alguma' },
  { code: 'NR-23', nome: 'Proteção contra incêndios', regra: { fonte: 'equipamento_incendio' }, agregacao: 'todas' },
];

export const NR_CODES: readonly string[] = NR_CATALOG.map((e) => e.code);

export type NrCode = string;

export function isNrCode(value: unknown): value is NrCode {
  return typeof value === 'string' && NR_CODES.includes(value);
}
