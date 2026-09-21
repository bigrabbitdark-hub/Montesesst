// Conferência de citações literais do dataset golden (Etapas 2 e 3 da
// Confiabilidade do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md
// §3.5). Módulo puro: sem I/O.
//
// O texto vigente de uma NR vem de PDF: quebra de linha no meio da frase,
// sumário no começo (o "6.3 Disposições gerais" do sumário aparece ANTES da
// seção de verdade) e hifenização no fim da linha. Por isso a `evidencia` de
// uma pergunta precisa COMEÇAR pelo número do item ("35.4.1 Todo trabalho em
// altura deve ser…") e ter um mínimo de texto depois dele
// (MIN_EVIDENCE_TEXT_LENGTH):
//  - o número ancora a citação no item declarado. Com o limite à esquerda de
//    checkEvidence, "4.1" não casa dentro de "35.4.1" nem "35.4.1" dentro de
//    "135.4.1";
//  - o piso de texto barra a linha CURTA do sumário ("35.4 Capacitação e
//    treinamento"). Ele NÃO barra uma linha longa de sumário (título comprido,
//    ou título com pontilhado e número de página): essa passa como citação
//    literal válida. A detecção de sumário mais forte, se for necessária, fica
//    para o lint da Task 4, que tem o texto bruto do documento.

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mesma normalização nos dois lados da comparação (texto do documento e
// evidência) e na saída do helper de autoria (eval:nr), então uma citação
// copiada do helper bate por construção. CRLF e CR solto viram LF ANTES das
// demais regras (senão o hífen no fim da linha não se junta com "\r\n" e a
// mesma frase normaliza diferente conforme a quebra de linha da origem).
// Hífen no fim da linha é MANTIDO (só se junta a linha seguinte): fiel ao PDF,
// sem inventar palavra colada.
export function normalizeForQuote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Zs}/gu, ' ')
    .replace(/-[ \t]*\n\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export type EvidenceFailure =
  | 'evidencia_nao_comeca_pelo_item'
  | 'evidencia_com_marcador_de_pagina'
  | 'evidencia_curta_demais'
  | 'evidencia_nao_encontrada';

export interface EvidenceCheck {
  ok: boolean;
  reason?: EvidenceFailure;
}

// Só o número do item não é citação: exige um mínimo de texto depois dele.
const MIN_EVIDENCE_TEXT_LENGTH = 30;

// O texto extraído dos PDFs traz artefatos de página no MEIO do item — o
// marcador "-- 2 of 12 --" e o cabeçalho "Este texto não substitui o publicado
// no DOU". Uma citação que os atravessa carregaria esse lixo; quem redige deve
// parar antes da quebra de página.
const PAGE_ARTIFACT = /--\s*\d+\s+of\s+\d+\s*--|Este texto não substitui o publicado no DOU/i;

export function checkEvidence(documentText: string, item: string, evidencia: string): EvidenceCheck {
  const quote = normalizeForQuote(evidencia);
  if (!quote.startsWith(`${item} `)) return { ok: false, reason: 'evidencia_nao_comeca_pelo_item' };
  if (PAGE_ARTIFACT.test(quote)) return { ok: false, reason: 'evidencia_com_marcador_de_pagina' };
  if (quote.length - item.length - 1 < MIN_EVIDENCE_TEXT_LENGTH) {
    return { ok: false, reason: 'evidencia_curta_demais' };
  }
  if (!occursAtItemBoundary(normalizeForQuote(documentText), quote)) {
    return { ok: false, reason: 'evidencia_nao_encontrada' };
  }
  return { ok: true };
}

// A citação só vale se ocorrer no documento numa posição em que o caractere
// imediatamente anterior NÃO seja dígito nem ponto (ou no início do texto).
// Sem esse limite à esquerda, "4.1 Todo…" casaria dentro de "35.4.1 Todo…" e
// "1. Os limites…" dentro de "11. Os limites…", e o item declarado não seria o
// item de verdade. NÃO se exige espaço ou quebra antes: o pdf-parse cola o
// cabeçalho ao marcador de página ("…-- 2 of 12 --35.4.1 Todo…") e isso é válido.
// Percorre TODAS as ocorrências (não só a primeira): uma ocorrência ruim pode
// vir antes de uma boa.
function occursAtItemBoundary(document: string, quote: string): boolean {
  let index = document.indexOf(quote);
  while (index !== -1) {
    if (index === 0 || !/[0-9.]/.test(document[index - 1])) return true;
    index = document.indexOf(quote, index + 1);
  }
  return false;
}

// O item aparece como título numerado no começo de uma linha do trecho
// (chunks são fatias do texto bruto, com as quebras de linha originais).
// Uma simples menção ("conforme o item 35.4.1") não conta.
export function chunkContainsItemHeading(content: string, item: string): boolean {
  return new RegExp(`(^|\\n)${escapeRegExp(item)}\\s`).test(content);
}
