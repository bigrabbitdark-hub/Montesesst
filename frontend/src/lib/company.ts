// Fonte única dos dados cadastrais públicos da Montese SST. Forneceu o
// fundador em 2026-09-21. Onde cada dado aparece (decisão do fundador):
//  - CNPJ: só em rodapés e telas de pagamento;
//  - endereço comercial: só nos documentos legais (Termos e Privacidade).
// A razão social ainda NÃO foi informada — nunca inventar: enquanto for
// `null`, os textos legais mostram o placeholder explícito abaixo.
export interface CompanyInfo {
  nomeFantasia: string;
  razaoSocial: string | null;
  cnpj: string;
  endereco: {
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
  };
}

export const company: CompanyInfo = {
  nomeFantasia: 'Montese SST',
  razaoSocial: null,
  cnpj: '69.203.754/0001-45',
  endereco: {
    logradouro: 'Avenida Marcolino Martins Cabral',
    numero: '2644',
    bairro: 'Aeroporto',
    municipio: 'Tubarão',
    uf: 'SC',
    cep: '88705-004',
  },
};

const RAZAO_SOCIAL_PENDENTE = '[RAZÃO SOCIAL — PREENCHER]';

export function formatAddress(): string {
  const e = company.endereco;
  return `${e.logradouro}, nº ${e.numero}, Bairro ${e.bairro}, ${e.municipio}/${e.uf}, CEP ${e.cep}`;
}

export function formatIdentification(): string {
  const razao = company.razaoSocial ?? RAZAO_SOCIAL_PENDENTE;
  return `${razao}, inscrita no CNPJ sob o nº ${company.cnpj}, com endereço comercial na ${formatAddress()}`;
}

// Os documentos em content/legal/*.mdx usam este token onde vai a
// identificação do controlador; getLegalDoc o substitui antes de compilar o MDX.
export function fillCompanyTokens(text: string): string {
  return text.replaceAll('[[EMPRESA_IDENTIFICACAO]]', formatIdentification());
}
