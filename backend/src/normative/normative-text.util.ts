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
      return decode(new TextDecoder(rotulo), buffer);
    } catch {
      // rótulo desconhecido: tenta o próximo
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return decode(new TextDecoder('windows-1252'), buffer);
  }
}

// O TextDecoder do Node 20 (o da imagem de produção) decodifica 'windows-1252' (e os rótulos iso-8859-1/latin1, que o
// WHATWG mapeia para ele) como ISO-8859-1: os bytes 0x80–0x9F viram controles C1 em vez de "–", "—", "“", "”", "€"…
// No Planalto isso troca o travessão do inciso ("III \x96 colisões", CLT art. 193) por um caractere invisível.
// Os 5 bytes sem caractere no windows-1252 (0x81, 0x8D, 0x8F, 0x90, 0x9D) ficam como estão.
const CP1252_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
function decode(decoder: TextDecoder, buffer: Buffer): string {
  const text = decoder.decode(buffer);
  return decoder.encoding === 'windows-1252' ? text.replace(/[\u0080-\u009f]/g, (c) => CP1252_80_9F[c.charCodeAt(0) - 0x80]) : text;
}

// Entidades HTML no TEXTO já sem tags (modo Planalto, ver extractHtmlText): o Planalto escreve `&quot;`, `&#150;`
// (meia-risca pela tabela windows-1252, como o HTML5 faz para 128–159) e `a&#768;` (acento grave combinante) — sem
// decodificar, isso ficava no literal do dispositivo. Uma passada só ("&amp;lt;" vira o texto "&lt;"). Entidade
// nomeada desconhecida fica como está; código inválido (0, substituto, > U+10FFFF) vira U+FFFD, como no HTML5. Espaço
// ou quebra vindos de entidade viram espaço comum (não criam linha). Medição nas 3 páginas de 2026-10-09: só `&quot;`
// (185/6/76 em CLT/Lei 8.213/Decreto 3.048), `&#150;` (36/8/0) e `&#768;` (0/2/0) sobravam no texto.
const ENTIDADES_NOMEADAS: Record<string, string> = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ',
  ordm: 'º', ordf: 'ª', deg: '°', sect: '§', para: '¶', middot: '·', laquo: '«', raquo: '»',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', euro: '€',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã',
  eacute: 'é', Eacute: 'É', ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í', oacute: 'ó', Oacute: 'Ó',
  ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', uacute: 'ú', Uacute: 'Ú', uuml: 'ü', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç',
};
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g, (ent, dec, hex, nome) => {
    let c: string;
    if (nome !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(ENTIDADES_NOMEADAS, nome)) return ent;
      c = ENTIDADES_NOMEADAS[nome];
    } else {
      const n = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) c = '�';
      else if (n >= 0x80 && n <= 0x9f) c = CP1252_80_9F[n - 0x80];
      else c = String.fromCodePoint(n);
    }
    return /\s/.test(c) && c !== ' ' ? ' ' : c;
  });
}

// O pdf-parse junta as páginas com marcadores "-- n of N --": um PDF escaneado de ~8 páginas passaria do
// mínimo sem ter texto de verdade. A barreira mede o texto sem esses marcadores.
export function meaningfulLength(text: string): number {
  return text.replace(/-- \d+ of \d+ --/g, ' ').trim().length;
}
