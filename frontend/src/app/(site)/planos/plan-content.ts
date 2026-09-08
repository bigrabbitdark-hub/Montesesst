export interface PlanContent {
  positioning: string;
  subtitle: string;
  bullets: string[];
  ctaLabel: string;
}

export const PLAN_CONTENT: Record<string, PlanContent> = {
  'empresa-start': {
    positioning: 'A base inteligente para organizar sua SST.',
    subtitle:
      'Para pequenas empresas que querem estruturar a rotina de Segurança do Trabalho sem manter um técnico dedicado internamente.',
    bullets: [
      'Assistente Montese SST (dúvidas, análise de documentos, localização de pendências, acompanhamento de prazos)',
      'Central de documentos (upload, organização, histórico)',
      'Cadastro de funcionários, cargos e filiais',
      'Gestão de EPIs (registro e entrega)',
      'Inspeções com checklist e plano de ação',
      'Calendário SST e central de pendências',
      'Atendimento técnico avulso sob consulta (online ou presencial, conforme disponibilidade e região)',
    ],
    ctaLabel: 'Começar gratuitamente',
  },
  'empresa-premium': {
    positioning: 'Plataforma + técnico SST online.',
    subtitle:
      'Para empresas que precisam de acompanhamento profissional sem manter um técnico de segurança contratado em tempo integral.',
    bullets: [
      'Tudo do Start, mais:',
      'Técnico responsável acompanhando sua empresa, atendimento remoto',
      'A inteligência organiza. O técnico avalia. A empresa decide.',
      'Atendimento online (videochamada, histórico de solicitações)',
      'Técnico com visão completa de pendências, inspeções, documentos, EPIs e treinamentos',
    ],
    ctaLabel: 'Quero SST + técnico',
  },
  'empresa-super-premium': {
    positioning: 'Acompanhamento contínuo de SST.',
    subtitle: 'Para empresas que precisam de uma atuação mais próxima e estruturada de Segurança do Trabalho.',
    bullets: [
      'Tudo do Premium, mais:',
      'O técnico acompanha ativamente os alertas e pendências da plataforma — não só responde quando chamado',
      'Gestão ativa: revisão de ações, acompanhamento de inspeções e treinamentos, reuniões periódicas',
      'Visitas presenciais incluídas conforme modalidade contratada e região',
    ],
    ctaLabel: 'Quero acompanhamento completo',
  },
  'empresa-enterprise': {
    positioning: 'SST estruturada para operações maiores e redes de empresas.',
    subtitle:
      'Para empresas com múltiplas unidades, operações complexas ou necessidade de estrutura personalizada de SST.',
    bullets: [
      'Tudo do Super Premium, mais:',
      'Gestão multiunidade (matriz, filiais, obras)',
      'Acesso à rede de técnicos parceiros da Montese (visitas presenciais em múltiplas unidades/regiões)',
      'Atendimento e relatórios personalizados conforme contrato',
    ],
    ctaLabel: 'Falar com especialista',
  },
};

export interface ComparisonRow {
  feature: string;
  start: string | boolean;
  premium: string | boolean;
  superPremium: string | boolean;
  enterprise: string | boolean;
}

export const COMPARISON_TABLE: ComparisonRow[] = [
  {
    feature: 'Plataforma + Assistente Montese SST + base normativa',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Documentos, funcionários, EPIs, inspeções',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Calendário SST e alertas de pendência',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Diagnóstico Inicial (upload em lote, importação de funcionários, Mapa SST)',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Atendimento técnico',
    start: 'Avulso, sob consulta',
    premium: 'Online incluído',
    superPremium: 'Acompanhamento ativo',
    enterprise: 'Rede completa',
  },
  {
    feature: 'Técnico acompanha alertas ativamente',
    start: false,
    premium: false,
    superPremium: true,
    enterprise: true,
  },
  { feature: 'Reuniões periódicas', start: false, premium: false, superPremium: true, enterprise: true },
  {
    feature: 'Visitas presenciais',
    start: 'Sob consulta',
    premium: false,
    superPremium: 'Conforme contrato',
    enterprise: 'Multiunidade',
  },
  { feature: 'Gestão multiunidade', start: false, premium: false, superPremium: false, enterprise: true },
  { feature: 'Rede de técnicos parceiros', start: false, premium: false, superPremium: false, enterprise: true },
  { feature: 'Integrações / customização', start: false, premium: false, superPremium: false, enterprise: true },
];

export interface AssistantStep {
  title: string;
  description: string;
}

export const ASSISTANT_STEPS: AssistantStep[] = [
  { title: 'Você envia', description: 'Documentos, planilhas, fotos, certificados, registros.' },
  {
    title: 'Montese organiza',
    description: 'Identifica informações, classifica, relaciona funcionário/cargo/setor, encontra pendências.',
  },
  { title: 'Montese acompanha', description: 'Alertas, tarefas, vencimentos, pontos de atenção.' },
];

export const ASSISTANT_TECHNICIAN_STEP: AssistantStep = {
  title: 'Técnico analisa e orienta',
  description: 'Nos planos com técnico incluído (Premium, Super Premium, Enterprise).',
};
