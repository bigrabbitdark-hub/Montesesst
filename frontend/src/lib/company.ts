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
  // WhatsApp comercial: ÚNICA fonte do número (só dígitos, com DDI) e da exibição.
  whatsapp: { numero: string; exibicao: string };
  // E-mail da responsável técnica para o diagnóstico gratuito.
  emailDiagnostico: string;
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
  cnpj: '',
  whatsapp: { numero: '5548992050516', exibicao: '+55 48 99205-0516' },
  emailDiagnostico: 'eng.evelynsouza@montesesst.com.br',
  endereco: {
    logradouro: 'Avenida Marcolino Martins Cabral',
    numero: '2644',
    bairro: 'Aeroporto',
    municipio: 'Tubarão',
    uf: 'SC',
    cep: '88705-004',
  },
};

export function whatsappUrl(mensagem?: string): string {
  const base = `https://wa.me/${company.whatsapp.numero}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem).replaceAll('!', '%21')}` : base;
}

export const MENSAGEM_DIAGNOSTICO_WHATSAPP =
  'Olá! Quero solicitar o diagnóstico gratuito de SST da minha empresa.';
export const ASSUNTO_DIAGNOSTICO_EMAIL = 'Solicitação de Diagnóstico Gratuito SST';

export function diagnosticoMailtoUrl(): string {
  return `mailto:${company.emailDiagnostico}?subject=${encodeURIComponent(ASSUNTO_DIAGNOSTICO_EMAIL)}`;
}

const RAZAO_SOCIAL_PENDENTE = '[RAZÃO SOCIAL — PREENCHER]';

export function formatAddress(): string {
  const e = company.endereco;
  return `${e.logradouro}, nº ${e.numero}, Bairro ${e.bairro}, ${e.municipio}/${e.uf}, CEP ${e.cep}`;
}

export function formatIdentification(): string {
  const razao = company.razaoSocial ?? RAZAO_SOCIAL_PENDENTE;
  return company.cnpj
    ? `${razao}, inscrita no CNPJ sob o nº ${company.cnpj}, com endereço comercial na ${formatAddress()}`
    : `${razao}, com endereço comercial na ${formatAddress()}`;
}

// Os documentos em content/legal/*.mdx usam este token onde vai a
// identificação do controlador; getLegalDoc o substitui antes de compilar o MDX.
export function fillCompanyTokens(text: string): string {
  return text.replaceAll('[[EMPRESA_IDENTIFICACAO]]', formatIdentification());
}
