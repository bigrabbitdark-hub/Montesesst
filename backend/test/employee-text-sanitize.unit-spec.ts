import { sanitizeDocumentText, sanitizeTitle } from '../src/employees/employee-text-sanitize';

// Cada classe de caractere hostil apontada na revisão de segurança. Escapes explícitos (nada de caractere invisível no código).
const CLASSES: Record<string, string> = {
  'U+061C': '؜', 'U+206A-206F': '⁪⁫⁬⁭⁮⁯', 'U+180E': '᠎', 'U+FFF9-FFFB': '￹￺￻',
  'U+0600-0605': '؀؁؂؃؄؅', 'U+06DD': '۝', 'U+070F': '܏', 'U+0890/0891': '࢐࢑', 'U+08E2': '࣢',
  'tags U+E0001/E0041': '\u{E0001}\u{E0041}\u{E007F}', 'uso privado BMP': '', 'uso privado plano 15': '\u{F0000}\u{FFFFD}',
  'RTL/LRO/ZWSP/BOM/soft hyphen': '‮‭​‏﻿­', 'ZWJ/ZWNJ': '‍‌', 'NUL/C0/C1': '\u0000\u0001\u001F\u007F\u0085\u009F',
  'surrogate alto solto': '\uD800', 'surrogate baixo solto': '\uDC00', 'surrogates soltos entre letras': '😀'.slice(0, 1),
};

describe('sanitizeDocumentText', () => {
  for (const [label, chars] of Object.entries(CLASSES)) {
    it(`remove ${label} e o resultado é seguro para JSON/jsonb`, () => {
      const out = sanitizeDocumentText(`SOL${chars}DADOR`);
      expect(out.replace(/ /g, '')).toBe('SOLDADOR');
      expect(JSON.stringify(out)).not.toMatch(/\\u[dD][89a-fA-F]/); // sem escape de surrogate
      expect(JSON.stringify(out)).not.toContain('\\u0000');
    });
  }
  it('U+2028/2029/000B/000C viram quebra de linha; \\n, \\t e acentos são preservados', () => {
    expect(sanitizeDocumentText('a b c\u000Bd\u000Ce\nf\tg')).toBe('a\nb\nc\nd\ne\nf\tg');
    expect(sanitizeDocumentText('Função: ELETRICISTA ÇÃO')).toBe('Função: ELETRICISTA ÇÃO');
  });
  it('par surrogate VÁLIDO (emoji) é preservado; só o solto cai', () => {
    expect(sanitizeDocumentText('A\u{1F600}B\uD800C')).toBe('A\u{1F600}BC');
  });
  it('zalgo: no máximo 3 marcas combinantes seguidas', () => {
    const z = 'A' + '́'.repeat(40) + 'B';
    expect(sanitizeDocumentText(z)).toBe('Á́́B');
    expect(sanitizeDocumentText('é')).toBe('é');
  });
  it('sanitizeTitle: uma linha, trim', () => {
    expect(sanitizeTitle('  a‮\nb​  ')).toBe('a b');
    expect(sanitizeTitle('‮​  ')).toBe('');
  });
  it('preenchimentos invisíveis (U+3164, U+2800, U+115F, U+1160, U+17B4/5, U+034F, U+E0000) são removidos sem quebrar acentos', () => {
    for (const ch of ['\u3164', '\u2800', '\u115F', '\u1160', '\u17B4', '\u17B5', '\u034F', '\u{E0000}']) {
      expect(sanitizeDocumentText(`SOLDA${ch}DOR`)).toBe('SOLDADOR');
    }
    expect(sanitizeDocumentText('Conceição João Ação Ñandú Việt')).toBe('Conceição João Ação Ñandú Việt');
    expect(sanitizeDocumentText('Conceic\u0327a\u0303o')).toBe('Conceic\u0327a\u0303o');
  });
});
