// Equipe exibida em /quem-somos. Todo dado pessoal fica null até o fundador
// enviar os dados reais — nunca inventar pessoas, registros ou experiência.
// A página só mostra cada campo quando ele estiver preenchido.
export interface TeamMember {
  id: string;
  name: string | null;
  role: string;
  /** O que a pessoa faz pelo cliente, em uma frase. */
  paraOCliente: string;
  /** caminho em /public, ex.: '/team/nome.jpg' */
  photo: string | null;
  linkedin: string | null;
  /** Registro profissional, ex.: 'Registro MTE nº 0000' ou 'Registro ativo'. */
  registro: string | null;
  /** Ex.: '8 anos atuando em construção civil'. */
  experiencia: string | null;
  cidade: string | null;
  /** Opcional: "por que trabalho com SST". */
  frasePessoal: string | null;
}

export const TEAM: TeamMember[] = [
  {
    id: 'socio-tecnologia',
    name: null,
    role: 'Sócio · Desenvolvimento e tecnologia',
    paraOCliente: 'Mantém a plataforma que organiza seus documentos, prazos e pendências em um só lugar.',
    photo: null,
    linkedin: null,
    registro: null,
    experiencia: null,
    cidade: null,
    frasePessoal: null,
  },
  {
    id: 'socio-tecnico',
    name: null,
    role: 'Sócio · Técnico de Segurança do Trabalho',
    paraOCliente: 'Confere a coerência da sua documentação e responde tecnicamente pelo acompanhamento.',
    photo: null,
    linkedin: null,
    registro: null,
    experiencia: null,
    cidade: null,
    frasePessoal: null,
  },
  {
    id: 'tecnico',
    name: null,
    role: 'Técnico de Segurança do Trabalho',
    paraOCliente: 'Acompanha a carteira de empresas e cuida para que nenhum vencimento ou pendência passe despercebido.',
    photo: null,
    linkedin: null,
    registro: null,
    experiencia: null,
    cidade: null,
    frasePessoal: null,
  },
];
