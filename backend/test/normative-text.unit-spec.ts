import {
  MIN_EXTRACTED_CHARS,
  MONITOR_FETCH_HEADERS,
  decodeHtmlBuffer,
  meaningfulLength,
  normalizeForComparison,
  suspiciousExtractionReason,
} from '../src/normative/normative-text.util';

describe('MONITOR_FETCH_HEADERS', () => {
  it('identifica o robô com honestidade, mas começa com Mozilla/5.0 (sem isso o planalto.gov.br deixa a conexão pendurada)', () => {
    expect(MONITOR_FETCH_HEADERS['User-Agent']).toMatch(
      /^Mozilla\/5\.0 \(compatible; MonteseSSTMonitor\/1\.0; \+https:\/\/montesesst\.com\.br\)$/,
    );
    expect(MONITOR_FETCH_HEADERS['Accept-Language']).toContain('pt-BR');
    expect(MONITOR_FETCH_HEADERS['Accept']).toContain('text/html');
  });
});

describe('normalizeForComparison', () => {
  const pagina = (modificado: string) =>
    `Imprensa Nacional Criado em 23/09/2020 14:06 ${modificado} Compartilhe : Busca DOU texto da norma`;

  it('ignora só o rótulo "Modificado em dd/mm/aaaa hh:mm" (caso real do LTCAT)', () => {
    expect(normalizeForComparison(pagina('Modificado em 28/08/2026 09:37'))).toBe(
      normalizeForComparison(pagina('Modificado em 05/10/2026 15:17')),
    );
  });

  it.each([
    'Atualizado em 01/02/2026',
    'Última atualização: 10/10/2026 08:00',
    'Ultima modificacao em 10/10/2026',
    'Última modificação 10/10/2026 08h00',
  ])('remove o rótulo volátil "%s"', (rotulo) => {
    expect(normalizeForComparison(`Art. 1º Texto. ${rotulo} Art. 2º Outro.`)).toBe('Art. 1º Texto. Art. 2º Outro.');
  });

  it('NÃO remove datas que fazem parte do conteúdo da norma', () => {
    const t = 'Publicado em 30/12/2022. Vigência a partir de 01/01/2027. Criado em 23/09/2020 14:06.';
    expect(normalizeForComparison(t)).toBe(t);
  });

  it('rótulos são só os de portal (maiúscula): frases jurídicas em minúsculas permanecem', () => {
    const a = 'O valor será atualizado em 01/01/2027, conforme regulamento.';
    expect(normalizeForComparison(a)).toBe(a);
    const b = 'texto atualizado em 01/01/2020 pela Portaria';
    expect(normalizeForComparison(b)).toBe(b);
  });

  it('uma mudança real de conteúdo continua diferente depois de normalizar', () => {
    const a = 'Art. 1º O prazo é de 30 dias. Modificado em 28/08/2026 09:37';
    const b = 'Art. 1º O prazo é de 60 dias. Modificado em 28/08/2026 09:37';
    expect(normalizeForComparison(a)).not.toBe(normalizeForComparison(b));
  });

  it('colapsa espaços', () => {
    expect(normalizeForComparison('a   b\n\n c ')).toBe('a b c');
  });
});

describe('suspiciousExtractionReason', () => {
  it('texto de 6 caracteres contra uma vigente de 35.754 é suspeito (caso real "EPI e custeio")', () => {
    expect(suspiciousExtractionReason(6, 35754)).toMatch(/Conteúdo suspeito/);
  });

  it(`menos de ${MIN_EXTRACTED_CHARS} caracteres é suspeito mesmo sem versão vigente`, () => {
    expect(suspiciousExtractionReason(MIN_EXTRACTED_CHARS - 1, null)).toMatch(/Conteúdo suspeito/);
    expect(suspiciousExtractionReason(MIN_EXTRACTED_CHARS, null)).toBeNull();
  });

  it('queda para menos de 20% da vigente é suspeita; exatamente 20% não', () => {
    expect(suspiciousExtractionReason(1999, 10000)).toMatch(/caiu para 1999/);
    expect(suspiciousExtractionReason(2000, 10000)).toBeNull();
  });

  it('textos normais não são suspeitos (primeira versão e mudança pequena)', () => {
    expect(suspiciousExtractionReason(7185, null)).toBeNull();
    expect(suspiciousExtractionReason(2185, 2168)).toBeNull();
  });

  it('a mensagem manda conferir a fonte', () => {
    expect(suspiciousExtractionReason(6, 35754)).toMatch(/confira a fonte/);
  });
});

describe('decodeHtmlBuffer', () => {
  const T = 'Presidência da República';
  it('latin1 sem charset declarado', () => {
    expect(decodeHtmlBuffer(Buffer.from(T, 'latin1'), 'text/html')).toBe(T);
  });
  it('utf8 sem charset declarado', () => {
    expect(decodeHtmlBuffer(Buffer.from(T, 'utf8'), 'text/html')).toBe(T);
  });
  it('charset no Content-Type', () => {
    expect(decodeHtmlBuffer(Buffer.from(T, 'latin1'), 'text/html; charset=iso-8859-1')).toBe(T);
  });
  it('charset no <meta>', () => {
    const b = Buffer.from(`<html><head><meta charset="iso-8859-1"></head><body>${T}</body></html>`, 'latin1');
    expect(decodeHtmlBuffer(b, 'text/html')).toContain(T);
  });
  it('rótulo desconhecido cai na detecção (utf8 e latin1)', () => {
    expect(decodeHtmlBuffer(Buffer.from(T, 'utf8'), 'text/html; charset=xx-inexistente')).toBe(T);
    expect(decodeHtmlBuffer(Buffer.from(T, 'latin1'), 'text/html; charset=xx-inexistente')).toBe(T);
  });
});

describe('meaningfulLength', () => {
  it('só marcadores de página -> 0', () => {
    const t = Array.from({ length: 10 }, (_, i) => `-- ${i + 1} of 10 --`).join('\n');
    expect(meaningfulLength(t)).toBe(0);
  });
  it('conta só o texto real quando há marcadores', () => {
    expect(meaningfulLength('Texto real\n-- 1 of 2 --\nmais texto')).toBe(23) // 'Texto real' + \n + espaço + \n + 'mais texto';
  });
  it('sem marcadores = trim().length', () => {
    expect(meaningfulLength('  abc def  ')).toBe(7);
  });
});
