// Avisos determinísticos por pergunta (Etapa 1 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-1.md §3).
// Módulo puro: sem I/O, sem LLM, sem dependência de NestJS — detecta, por
// gatilhos de texto, perguntas que dependem de legislação estadual/municipal,
// de habilitação profissional ou de contexto que o usuário não informou, e
// devolve um aviso fixo por tipo. O aviso é aditivo: nunca bloqueia a
// resposta.
export type NoticeType = 'jurisdicao' | 'profissional_habilitado' | 'contexto';

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
      /\bmeu (estado|municipio|cidade)\b/,
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
  for (const { tipo, patterns } of TRIGGERS) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      notices.push({ tipo, texto: NOTICE_TEXTS[tipo] });
    }
  }
  return notices;
}
