// Saneamento de texto vindo de documentos (PDF/DOCX) e de nomes de arquivo antes de chegar ao extrator, à IA, à
// evidência, ao jsonb e ao cadastro. Puro e sem dependências.
// - U+000B/000C/2028/2029 viram quebra de linha; demais controles C0/C1 viram espaço;
// - removidos: formatação invisível/direção (\p{Cf}: ZWSP, RTL/LRO, U+061C, U+206A–206F, U+180E, tags, soft hyphen, BOM...),
//   separadores de linha/parágrafo, uso privado (\p{Co}) e SURROGATES SOLTOS (JSON.stringify os escreve como "\ud800" e o
//   jsonb do Postgres recusa);
// - sequências de marcas combinantes (zalgo) limitadas a 3.
export function sanitizeDocumentText(t: string): string {
  return t
    .replace(/[\u000B\u000C\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, ' ')
    // Com a flag u, [\uD800-\uDFFF] só casa surrogate SOLTO (um par válido é um único code point).
    .replace(/[\uD800-\uDFFF]/gu, '')
    // Preenchimentos invisíveis que não são \p{Cf}: Hangul filler (U+115F, U+1160, U+3164), braille em branco (U+2800), Khmer
    // inerentes (U+17B4/17B5), CGJ (U+034F) e U+E0000 (tag não atribuído).
    .replace(/[\p{Cf}\p{Zl}\p{Zp}\p{Co}\u3164\u2800\u115F\u1160\u17B4\u17B5\u034F\u{E0000}]/gu, '')
    .replace(/(\p{M}{3})\p{M}+/gu, '$1');
}

// Título/nome de arquivo: o mesmo saneamento, em uma linha só.
export const sanitizeTitle = (t: string): string => sanitizeDocumentText(t).replace(/\s+/g, ' ').trim();
