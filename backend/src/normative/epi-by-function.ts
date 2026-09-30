// Guia de referência EPI-por-função (Fase A — Etapa 2 da evolução do
// Assistente). Constante embutida no código, NÃO persistida em banco.
//
// Por que constante e não migration:
// 1. EPI-por-função é uma curadoria operacional da Montese baseada nas
//    atribuições das NRs aplicáveis (NR-06, NR-10, NR-11, NR-12, NR-18,
//    NR-33, NR-35) e em prática de mercado. Misturá-la com
//    normative_document_chunks (texto literal do MTE/Fundacentro)
//    corromperia a fronteira evidência oficial vs curadoria interna.
// 2. Mudanças no catálogo de EPI exigem revisão humana (engenheiro
//    habilitado) antes de mudar; migration escrita por IA nesse campo é
//    vetor de erro direto ao usuário final.
// 3. O texto desta constante é injetado no SYSTEM_PROMPT como
//    "referência auxiliar", não como fonte normativa — a hierarquia
//    oficial > empresa > técnico > curadoria interna continua válida.
//
// Não substitui o PGR/PCMSO/LTCAT próprio da empresa nem a avaliação
// do técnico legalmente habilitado.

export interface EpiByFunctionRow {
  funcao: string;
  // Códigos das NRs que fundamentam a lista (sem texto oficial, só a
  // referência para o modelo cruzar com a evidência normativa).
  nrs: string[];
  // Lista curta de EPIs esperados para a função. Texto em português
  // simples — o modelo formata no estilo de fala.
  epis: string[];
}

export const EPI_BY_FUNCTION: EpiByFunctionRow[] = [
  // Construção civil (NR-18)
  { funcao: 'Pedreiro', nrs: ['NR-06', 'NR-18'], epis: ['Capacete com jugular', 'Botina com biqueira de aço', 'Luva de raspa', 'Óculos de proteção', 'Protetor auricular quando ruído > 85 dBA'] },
  { funcao: 'Servente', nrs: ['NR-06', 'NR-18'], epis: ['Capacete', 'Botina de segurança', 'Luva de raspa ou vaqueta', 'Protetor solar quando exposto'] },
  { funcao: 'Armador', nrs: ['NR-06', 'NR-18'], epis: ['Capacete com jugular', 'Botina de segurança', 'Luva de raspa', 'Óculos', 'Cinto de segurança com talabarte em altura > 2 m'] },
  { funcao: 'Carpinteiro', nrs: ['NR-06', 'NR-12', 'NR-18'], epis: ['Capacete', 'Botina', 'Luva de raspa', 'Óculos', 'Protetor auricular', 'Máscara PFF2 ou P3 para poeira de madeira'] },
  { funcao: 'Pintor', nrs: ['NR-06', 'NR-18'], epis: ['Capacete', 'Botina', 'Luva nitrílica', 'Máscara com filtro químico para solventes', 'Óculos'] },

  // Metalurgia/solda (NR-12)
  { funcao: 'Soldador', nrs: ['NR-06', 'NR-12'], epis: ['Máscara de solda com filtro adequado à amperagem', 'Avental de raspa', 'Luva de raspa cano longo', 'Perneira de raspa', 'Botina com biqueira'] },
  { funcao: 'Maçariqueiro', nrs: ['NR-06', 'NR-12'], epis: ['Óculos com filtro para oxiacetileno', 'Luva de raspa', 'Avental de raspa', 'Protetor auricular'] },
  { funcao: 'Caldeireiro', nrs: ['NR-06', 'NR-12', 'NR-13'], epis: ['Capacete com jugular', 'Botina', 'Luva de raspa', 'Óculos', 'Protetor auricular', 'Cinto em altura > 2 m'] },

  // Elétrica/manutenção (NR-10, NR-12)
  { funcao: 'Eletricista', nrs: ['NR-06', 'NR-10', 'NR-12'], epis: ['Capacete classe B (isolante)', 'Luva isolante de borracha classe conforme tensão', 'Óculos', 'Botina dielétrica', 'Cinto com talabarte em altura'] },
  { funcao: 'Montador eletromecânico', nrs: ['NR-06', 'NR-12'], epis: ['Capacete', 'Botina', 'Luva de raspa', 'Óculos', 'Protetor auricular'] },
  { funcao: 'Técnico de manutenção', nrs: ['NR-06', 'NR-10', 'NR-12'], epis: ['Capacete', 'Luva adequada ao risco', 'Óculos', 'Botina', 'Protetor auricular'] },

  // Movimentação de cargas / máquinas (NR-11, NR-12)
  { funcao: 'Operador de empilhadeira', nrs: ['NR-06', 'NR-11', 'NR-12'], epis: ['Botina com biqueira', 'Capacete', 'Protetor auricular', 'Cinto se a empilhadeira tiver'] },
  { funcao: 'Operador de máquina pesada', nrs: ['NR-06', 'NR-11', 'NR-12'], epis: ['Botina com biqueira', 'Capacete', 'Protetor auricular', 'Óculos'] },
  { funcao: 'Motorista profissional', nrs: ['NR-06'], epis: ['Botina ou calçado fechado quando carrega/descarrega', 'Colete refletivo em área de tráfego'] },

  // Altura / espaço confinado (NR-33, NR-35)
  { funcao: 'Trabalho em altura (> 2m)', nrs: ['NR-06', 'NR-35'], epis: ['Cinto tipo paraquedista com talabarte duplo', 'Capacete com jugular', 'Botina', 'Luva de raspa'] },
  { funcao: 'Trabalho em espaço confinado', nrs: ['NR-06', 'NR-33'], epis: ['Máscara autônoma ou com linha de ar', 'Cinto com talabarte para entrada e resgate', 'Capacete', 'Luvas adequadas ao contaminante'] },

  // Postos / varejo
  { funcao: 'Frentista de posto', nrs: ['NR-06', 'NR-16', 'NR-20'], epis: ['Calçado fechado com solado antiestático', 'Avental de PVC', 'Luva de nitrilo', 'Óculos'] },
  { funcao: 'Atendente de loja', nrs: ['NR-06'], epis: ['Calçado fechado antiderrapante'] },

  // Administrativo / apoio
  { funcao: 'Auxiliar administrativo', nrs: ['NR-06', 'NR-17'], epis: ['Calçado fechado (risco ergonômico avaliado por NR-17)', 'Apoio lombar / posto ajustado'] },
  { funcao: 'Copeira / cozinha', nrs: ['NR-06', 'NR-12'], epis: ['Calçado fechado antiderrapante', 'Avental', 'Luva de proteção térmica'] },
  { funcao: 'Faxineiro / serviços gerais', nrs: ['NR-06'], epis: ['Luva de borracha nitrílica', 'Botina ou calçado fechado antiderrapante', 'Óculos para respingos'] },
];

export function epiByFunctionForPrompt(): string {
  return EPI_BY_FUNCTION.map((row) => {
    const epis = row.epis.join('; ');
    return `- ${row.funcao} (${row.nrs.join('/')}): ${epis}`;
  }).join('\n');
}

// Achado da auditoria do Assistente (2026-09-28, C-3): SYSTEM_PROMPT_WITH_EPI_GUIDE
// (normative-answer-shared.ts) foi construído na Fase A — Etapa 2 pra ser
// passado como 7º argumento de NormativeAnswerProvider.answer() "quando a
// pergunta casa em 'EPI por função'", mas o detector nunca foi escrito — o
// call site real em normative-assistant.service.ts sempre chamava
// answer(...) com só 6 argumentos, então SYSTEM_PROMPT_WITH_EPI_GUIDE nunca
// era usado, mesmo em produção com o build mais recente. Confirmado por
// grep: zero usos fora da própria definição.
//
// Deliberadamente amplo (qualquer menção a "EPI"/"EPIs"), não restrito a
// "que EPI o pedreiro precisa": o próprio SYSTEM_PROMPT_WITH_EPI_GUIDE já
// instrui o modelo a usar o guia só pra pergunta de função ("Use apenas
// para perguntas tipo…") e a nunca tratá-lo como texto oficial — o filtro
// aqui só decide se vale a pena gastar ~20 linhas extra de contexto, não
// decide sozinho o comportamento final. Restringir demais aqui arriscaria
// esconder o guia justamente da pergunta "que EPI preciso pra soldar" se o
// fraseio não bater um padrão mais específico.
const EPI_QUESTION_PATTERN = /\bepis?\b/i;

export function isEpiQuestion(question: string): boolean {
  return EPI_QUESTION_PATTERN.test(question);
}
