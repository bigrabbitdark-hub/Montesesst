// Avisos determinísticos por pergunta (Etapa 1 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-1.md §3).
// Módulo puro: sem I/O, sem LLM, sem dependência de NestJS — detecta, por
// gatilhos de texto, perguntas que dependem de legislação estadual/municipal,
// de habilitação profissional ou de contexto que o usuário não informou, e
// devolve um aviso fixo por tipo. O aviso é aditivo: nunca bloqueia a
// resposta.
//
// Etapa 2: novos tipos adicionados ao lado dos existentes, mantendo
// compatibilidade.
// - vencimento_vencido: pergunta cita prazo/validade em passado — lembrar
//   que há auditoria de vencimentos no operacional.
// - dado_insuficiente: pergunta é genérica e exige contexto da empresa
//   (CNAE, nº funcionários, grau de risco, estado).
// - geografia: derivada de pergunta mencionando estado/município, distinta
//   da jurisdicao para granularidade (jurisdicao é regulatório, geografia
//   é só contextualização).
export type NoticeType =
  | 'jurisdicao'
  | 'profissional_habilitado'
  | 'contexto'
  | 'vencimento_vencido'
  | 'dado_insuficiente'
  | 'geografia';

export interface NormativeNotice {
  tipo: NoticeType;
  texto: string;
}

const NOTICE_TEXTS: Record<NoticeType, string> = {
  jurisdicao:
    'A base atual só contém as Normas Regulamentadoras federais (MTE). Exigências estaduais e municipais — como as do Corpo de Bombeiros, licenciamento e alvarás — não estão na base. Informe o estado e o município e confirme com o órgão competente.',
  profissional_habilitado:
    'Posso explicar o que a norma exige, mas quem executa ou assina este serviço depende da habilitação legal do profissional. Confirme com o conselho profissional competente.',
  contexto:
    'Para uma resposta precisa, informe o número de empregados, a atividade (CNAE), o grau de risco e o estado da empresa.',
  vencimento_vencido:
    'Esta pergunta cita prazos ou validades. Verifique se o documento/programa já venceu ou está próximo de vencer no Cadastro de Vencimentos (operacional da empresa).',
  dado_insuficiente:
    'A pergunta é genérica. Para uma resposta precisa, contextualize: qual NR, qual função, qual setor, qual documento da empresa você quer avaliar.',
  geografia:
    'Esta pergunta cita estado/município. Exigências federais (NRs) valem em todo o território; exigências estaduais/municipais precisam ser confirmadas com o órgão competente daquela unidade da federação.',
};

// Ordem do array = ordem dos avisos no resultado. Os padrões rodam sobre a
// pergunta já normalizada (minúsculas, sem acentos), então "alvará" vira
// "alvara" e "município" vira "municipio".
const TRIGGERS: { tipo: NoticeType; patterns: RegExp[] }[] = [
  {
    tipo: 'jurisdicao',
    patterns: [
      /\bppci\b/,
      /\bavcb\b/,
      /\bclcb\b/,
      /\bbombeiros?\b/,
      /\balvara\b/,
      /\blicenca ambiental\b/,
      /\blicenciamento\b/,
      /\bcodigo de obras\b/,
      // "cidade" é feminino ("minha cidade", nunca "meu cidade") — ver ITEM
      // 007 da auditoria do Assistente (2026-09-28).
      /\bmeu (estado|municipio)\b/,
      /\bminha cidade\b/,
      /\b(estadual|estaduais|municipal|municipais)\b/,
    ],
  },
  {
    tipo: 'profissional_habilitado',
    patterns: [
      /\bquem pode (assinar|emitir|elaborar|executar|realizar)\b/,
      // "art" sozinho é a ART (Anotação de Responsabilidade Técnica); "art. 157"
      // / "art 157" é artigo de lei e não pode disparar o aviso.
      /\bart\b(?!\.?\s*\d)/,
      /\brrt\b/,
      /\bresponsavel tecnico\b/,
      /\batribuic(ao|oes) profissiona(l|is)\b/,
      /\bprofissional habilitado\b/,
      /\blegalmente habilitado\b/,
      /\bassinar (o |a |um |uma )?(laudo|projeto|pgr|pcmso|ltcat|ppra|apr)\b/,
    ],
  },
  {
    tipo: 'contexto',
    patterns: [
      /\bminha empresa (precisa|tem que|deve)\b/,
      /\bsou obrigad[oa]\b/,
      /\bpreciso (ter|fazer|elaborar|implantar|de)\b/,
      /\be obrigatorio\b/,
    ],
  },
  {
    tipo: 'vencimento_vencido',
    patterns: [
      // Prazo / validade / venceu / vencer / expira
      /\b(venc|venc[ei]u|venc[ie]r[áa]|expira[dr]?|expirou)\b/,
      /\b(validade|valido ate|valido at[eé])\b/,
      /\bprazo (de|d)?\s*(validade|vig[êe]ncia|cumprimento|atualiza[cç][ãa]o)\b/,
      /\bvig[êe]ncia\b/,
    ],
  },
  {
    tipo: 'dado_insuficiente',
    patterns: [
      // Pergunta extremamente curta sem contexto (4 palavras ou menos).
      // NÃO dispara se a pergunta cita NR específica.
      // Implementado em tempo de execução em detectNotices().
    ],
  },
  {
    tipo: 'geografia',
    patterns: [
      // Estado / UF explícita (sigla).
      /\b(al|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)\b\s*(?:[,\.\?\!]|$)/i,
      // Mesma correção de concordância de gênero do ITEM 007 acima.
      /\bno (estado|municipio) de\b/,
      /\bna cidade de\b/,
      /\bda (bahia|s[aã]o paulo|rio|minas|paran[aá]|santa catarina|rio grande do sul|goi[aá]s|alagoas|cear[aá]|maranh[aã]o|pernambuco|par[aá]|para[ií]ba|esp[ií]rito santo|sergipe|amaz[oô]nas|par[aá]|tocantins|ac[re]+|roraima|rond[oô]nia|distrito federal)\b/i,
    ],
  },
];

function normalizeQuestion(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectNotices(question: string): NormativeNotice[] {
  const normalized = normalizeQuestion(question);
  const notices: NormativeNotice[] = [];
  const seen = new Set<NoticeType>();

  for (const { tipo, patterns } of TRIGGERS) {
    // Regra especial para dado_insuficiente: dispara se a pergunta tem
    // <= 4 palavras E não cita NR ("nr X" / "nr-X" / "nrs X Y" / "nrs X e Y")
    // E já não disparou jurisdicao/profissional_habilitado (sinais de que o
    // usuário sabe o que está perguntando).
    if (tipo === 'dado_insuficiente') {
      const words = normalized.split(/\s+/).filter(Boolean);
      const mentionsNr = /\bnr-?\d{1,2}/.test(normalized);
      // Achado da auditoria do Assistente (2026-09-28, C-4): o comentário
      // acima ("já não disparou jurisdicao/profissional_habilitado") nunca
      // virou código — esta checagem estava ausente. Sem ela, uma pergunta
      // curta que já casa em jurisdicao/profissional_habilitado (ex.: "Como
      // funciona o licenciamento?", "Preciso de RRT?") ganhava os DOIS
      // avisos, mesmo o usuário já tendo demonstrado saber exatamente o que
      // está perguntando. TRIGGERS processa jurisdicao/profissional_habilitado
      // ANTES de dado_insuficiente (ordem do array), então `seen` já reflete
      // esta mesma chamada nesse ponto do loop.
      const alreadyShowsIntent = seen.has('jurisdicao') || seen.has('profissional_habilitado');
      if (words.length > 0 && words.length <= 4 && !mentionsNr && !alreadyShowsIntent) {
        notices.push({ tipo, texto: NOTICE_TEXTS[tipo] });
        seen.add(tipo);
      }
      continue;
    }

    if (patterns.length === 0) continue;
    if (patterns.some((pattern) => pattern.test(normalized))) {
      if (!seen.has(tipo)) {
        notices.push({ tipo, texto: NOTICE_TEXTS[tipo] });
        seen.add(tipo);
      }
    }
  }
  return notices;
}
