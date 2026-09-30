// Equipe exibida em /quem-somos. Nome, foto e LinkedIn ficam null até o
// fundador enviar os dados reais — nunca inventar pessoas. A página mostra
// uma vaga neutra ("em breve") para cada campo nulo.
export interface TeamMember {
  id: string;
  name: string | null;
  role: string;
  /** caminho em /public, ex.: '/team/nome.jpg' */
  photo: string | null;
  linkedin: string | null;
}

export const TEAM: TeamMember[] = [
  { id: 'socio-tecnologia', name: null, role: 'Sócio · Desenvolvimento e tecnologia', photo: null, linkedin: null },
  { id: 'socio-tecnico', name: null, role: 'Sócio · Técnico de Segurança do Trabalho', photo: null, linkedin: null },
  { id: 'tecnico', name: null, role: 'Técnico de Segurança do Trabalho', photo: null, linkedin: null },
];
