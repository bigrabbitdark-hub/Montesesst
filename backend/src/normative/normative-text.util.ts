// Utilitários do monitor das fontes normativas: cabeçalhos de requisição, normalização para comparar
// versões e barreira contra extração degenerada. Funções puras, testáveis sem banco.

// O planalto.gov.br deixa a conexão pendurada quando o User-Agent não começa com "Mozilla/5.0"
// (verificado em 2026-10-08: com este UA responde 200 em < 2 s). O UA identifica o robô com honestidade.
export const MONITOR_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; MonteseSSTMonitor/1.0; +https://montesesst.com.br)',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

// Rótulos de data/hora que mudam sozinhos em páginas de portal (ex.: Imprensa Nacional mostra
// "Modificado em 05/10/2026 15:17"). Só entram aqui rótulos com prefixo explícito. NÃO usar similaridade
// percentual nem remover datas em geral: "Publicado em …" e vigências são conteúdo do ato, e uma emenda
// real a uma NR grande também dá ~99% de similaridade.
const DATA_HORA = String.raw`\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}[:h]\d{2}(?::\d{2})?)?`;
const ROTULOS_VOLATEIS: RegExp[] = [
  new RegExp(String.raw`(?:Modificado|Atualizado)\s+em\s+${DATA_HORA}`, 'g'),
  new RegExp(
    String.raw`[ÚU]ltima\s+(?:modifica[çc][ãa]o|atualiza[çc][ãa]o)\s*:?\s*(?:em\s+)?${DATA_HORA}`,
    'g',
  ),
];

export function normalizeForComparison(text: string): string {
  let normalizado = text;
  for (const rotulo of ROTULOS_VOLATEIS) {
    normalizado = normalizado.replace(rotulo, ' ');
  }
  return normalizado.replace(/\s+/g, ' ').trim();
}

// Extração vazia ou quebrada não pode virar pendente aprovável: aprovar substituiria uma norma boa do
// Assistente por lixo (caso real: 6 caracteres contra 35.754 da vigente).
export const MIN_EXTRACTED_CHARS = 100;
export const MIN_RATIO_VS_VIGENTE = 0.2;

export function suspiciousExtractionReason(extractedChars: number, vigenteChars: number | null): string | null {
  if (extractedChars < MIN_EXTRACTED_CHARS) {
    return `Conteúdo suspeito: o texto extraído tem ${extractedChars} caracteres (mínimo ${MIN_EXTRACTED_CHARS}); a página pode ter mudado de formato ou bloqueado o robô — confira a fonte`;
  }
  if (vigenteChars && extractedChars < vigenteChars * MIN_RATIO_VS_VIGENTE) {
    return `Conteúdo suspeito: o texto extraído caiu para ${extractedChars} caracteres (a versão vigente tem ${vigenteChars}); a página pode ter mudado de formato — confira a fonte`;
  }
  return null;
}

// Páginas do planalto.gov.br vêm em ISO-8859-1 SEM charset declarado: ler como UTF-8 corrompe os acentos
// ("Presid�ncia"). Ordem: charset do Content-Type, charset do <meta>, UTF-8 estrito, windows-1252.
export function decodeHtmlBuffer(buffer: Buffer, contentType: string): string {
  const doHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const doMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString('latin1'))?.[1];
  for (const rotulo of [doHeader, doMeta]) {
    if (!rotulo) continue;
    try {
      return new TextDecoder(rotulo).decode(buffer);
    } catch {
      // rótulo desconhecido: tenta o próximo
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// O pdf-parse junta as páginas com marcadores "-- n of N --": um PDF escaneado de ~8 páginas passaria do
// mínimo sem ter texto de verdade. A barreira mede o texto sem esses marcadores.
export function meaningfulLength(text: string): number {
  return text.replace(/-- \d+ of \d+ --/g, ' ').trim().length;
}
