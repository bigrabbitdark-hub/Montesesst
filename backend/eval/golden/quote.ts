// Conferência de citações literais do dataset golden (Etapas 2 e 3 da
// Confiabilidade do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md
// §3.5). Módulo puro: sem I/O.
//
// O texto vigente de uma NR vem de PDF: quebra de linha no meio da frase,
// sumário no começo (o "6.3 Disposições gerais" do sumário aparece ANTES da
// seção de verdade) e hifenização no fim da linha. Por isso a `evidencia` de
// uma pergunta precisa COMEÇAR pelo número do item ("35.4.1 Todo trabalho em
// altura deve ser…"): isso ancora a citação numa seção real e evita casar com
// uma linha do sumário.

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mesma normalização nos dois lados da comparação (texto do documento e
// evidência) e na saída do helper de autoria (eval:nr), então uma citação
// copiada do helper bate por construção. Hífen no fim da linha é MANTIDO
// (só se junta a linha seguinte): fiel ao PDF, sem inventar palavra colada.
export function normalizeForQuote(text: string): string {
  return text
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
  if (!normalizeForQuote(documentText).includes(quote)) {
    return { ok: false, reason: 'evidencia_nao_encontrada' };
  }
  return { ok: true };
}

// O item aparece como título numerado no começo de uma linha do trecho
// (chunks são fatias do texto bruto, com as quebras de linha originais).
// Uma simples menção ("conforme o item 35.4.1") não conta.
export function chunkContainsItemHeading(content: string, item: string): boolean {
  return new RegExp(`(^|\\n)${escapeRegExp(item)}\\s`).test(content);
}
