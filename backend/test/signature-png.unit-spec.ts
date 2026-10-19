import PDFDocument from 'pdfkit';
import { validateSignaturePng, MAX_CANONICAL_BYTES, MAX_SIGNATURE_BYTES } from '../src/epi-signature/signature-png.util';
import {
  assemblePng, blankPng, chunk, chunkTypesOf, decodeUnfilteredPixels, IHDR_OF, makeFilteredPng, makePng, makePngFromRaw, noisePng,
  pngWithoutIdat, strokePng,
} from './helpers/png';
import { deflateSync } from 'zlib';

const stroke = (x: number, y: number): [number, number, number, number] => (Math.abs(y - 50 - Math.round(20 * Math.sin(x / 15))) <= 2 ? [0, 0, 0, 255] : [0, 0, 0, 0]);
const insertBeforeIend = (png: Buffer, ch: Buffer) => Buffer.concat([png.subarray(0, png.length - 12), ch, png.subarray(png.length - 12)]);
const insertAfterIhdr = (png: Buffer, ch: Buffer) => Buffer.concat([png.subarray(0, 8 + 25), ch, png.subarray(8 + 25)]);
const pixelsOf = (png: Buffer) => decodeUnfilteredPixels(png).px;

describe('validateSignaturePng', () => {
  it('aceita PNG RGBA com traço e devolve um canonical equivalente', () => {
    const r = validateSignaturePng(strokePng());
    expect(r.width).toBe(300);
    expect(r.height).toBe(100);
    expect(r.canonical.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(chunkTypesOf(r.canonical)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(pixelsOf(r.canonical).equals(pixelsOf(strokePng()))).toBe(true);
    // o canonical é ele mesmo válido (idempotente)
    expect(pixelsOf(validateSignaturePng(r.canonical).canonical).equals(pixelsOf(r.canonical))).toBe(true);
  });
  it('aceita PNG válido perto do teto de 200 KB', () => {
    const big = noisePng(224, 225);
    expect(big.length).toBeGreaterThan(190 * 1024);
    expect(big.length).toBeLessThanOrEqual(MAX_SIGNATURE_BYTES);
    const r = validateSignaturePng(big);
    expect(pixelsOf(r.canonical).equals(pixelsOf(big))).toBe(true);
  });
  it('filtros 1, 2, 3 e 4 reais são desfiltrados corretamente (canonical idêntico em pixels, filtro 0)', () => {
    const ref = pixelsOf(makeFilteredPng(300, 100, stroke, 0));
    for (const f of [1, 2, 3, 4]) {
      const r = validateSignaturePng(makeFilteredPng(300, 100, stroke, f));
      expect({ f, igual: pixelsOf(r.canonical).equals(ref) }).toEqual({ f, igual: true });
    }
    // filtro variando por linha, em imagem com ruído (exercita Average/Paeth com valores altos)
    let s = 7; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
    const noise = (): [number, number, number, number] => [rnd(), rnd(), rnd(), rnd() | 128];
    const cache = new Map<string, [number, number, number, number]>();
    const px = (x: number, y: number) => { const k = `${x},${y}`; if (!cache.has(k)) cache.set(k, noise()); return cache.get(k)!; };
    const mixed = makeFilteredPng(120, 60, px, (y) => y % 5);
    expect(pixelsOf(validateSignaturePng(mixed).canonical).equals(pixelsOf(makeFilteredPng(120, 60, px, 0)))).toBe(true);
  });
  it('byte de filtro inválido (7) -> 400', () => {
    expect(() => validateSignaturePng(makeFilteredPng(300, 100, stroke, 7))).toThrow(/inválida/i);
    expect(() => validateSignaturePng(makeFilteredPng(300, 100, stroke, (y) => (y === 99 ? 5 : 0)))).toThrow(/inválida/i); // só na última linha
  });
  it('rejeita canvas em branco, RGB não nulo com alfa 0, 1 pixel visível e alfa baixo', () => {
    expect(() => validateSignaturePng(blankPng())).toThrow(/em branco/i);
    expect(() => validateSignaturePng(makePng(300, 100, () => [255, 255, 255, 0]))).toThrow(/em branco/i);
    expect(() => validateSignaturePng(makePng(300, 100, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [0, 0, 0, 0])))).toThrow(/poucos pixels/i);
    expect(() => validateSignaturePng(makePng(300, 100, () => [0, 0, 0, 127]))).toThrow(/em branco/i);
    expect(() => validateSignaturePng(makePng(300, 100, (x, y) => (y === 0 && x < 19 ? [0, 0, 0, 255] : [0, 0, 0, 1])))).toThrow(/poucos pixels/i); // 19 < 20
    expect(validateSignaturePng(makePng(300, 100, (x, y) => (y === 0 && x < 20 ? [0, 0, 0, 255] : [0, 0, 0, 0]))).width).toBe(300); // 20 basta
  });
  it('chunk acessório (tEXt) é ignorado e removido do canonical', () => {
    const withText = insertBeforeIend(strokePng(), chunk('tEXt', Buffer.alloc(100 * 1024, 0x41)));
    expect(withText.length).toBeLessThanOrEqual(MAX_SIGNATURE_BYTES + 1024);
    const small = insertBeforeIend(strokePng(), chunk('tEXt', Buffer.from('Comment\0oi')));
    const r = validateSignaturePng(small);
    expect(chunkTypesOf(r.canonical)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(r.canonical.includes(Buffer.from('Comment'))).toBe(false);
    expect(pixelsOf(r.canonical).equals(pixelsOf(strokePng()))).toBe(true);
  });
  it('rejeita chunk crítico desconhecido e APNG (acTL/fcTL/fdAT)', () => {
    expect(() => validateSignaturePng(insertBeforeIend(strokePng(), chunk('ABCD', Buffer.alloc(10))))).toThrow(/formato/i);
    const a = Buffer.alloc(8); a.writeUInt32BE(2, 0);
    expect(() => validateSignaturePng(insertAfterIhdr(strokePng(), chunk('acTL', a)))).toThrow(/formato/i);
    expect(() => validateSignaturePng(insertAfterIhdr(strokePng(), chunk('fcTL', Buffer.alloc(26))))).toThrow(/formato/i);
    expect(() => validateSignaturePng(insertBeforeIend(strokePng(), chunk('fdAT', Buffer.alloc(8))))).toThrow(/formato/i);
  });
  it('rejeita CRC errado (IHDR, IDAT e acessório), dados após IEND e IEND ausente', () => {
    const p = strokePng();
    const badIdat = Buffer.from(p); badIdat[badIdat.length - 13] ^= 0xff;
    expect(() => validateSignaturePng(badIdat)).toThrow(/inválida/i);
    const badIhdr = Buffer.from(p); badIhdr[8 + 8 + 4] ^= 0x01; // altera a largura sem refazer o CRC
    expect(() => validateSignaturePng(badIhdr)).toThrow(/inválida/i);
    const txt = insertBeforeIend(p, chunk('tEXt', Buffer.from('a\0b'))); txt[txt.length - 12 - 5] ^= 0xff;
    expect(() => validateSignaturePng(txt)).toThrow(/inválida/i);
    expect(() => validateSignaturePng(Buffer.concat([p, Buffer.from('<html><script>1</script></html>')]))).toThrow(/inválida/i);
    expect(() => validateSignaturePng(p.subarray(0, p.length - 12))).toThrow(/inválida/i);
  });
  it('rejeita IDAT não contíguos, IHDR duplicado e IHDR fora de ordem', () => {
    const raw = Buffer.alloc(100 * 300 * 4 + 100); // zeros: o resultado não importa, a estrutura é rejeitada antes
    const z = deflateSync(raw), half = z.length >> 1;
    const ih = chunk('IHDR', IHDR_OF(300, 100, 6, 0));
    expect(() => validateSignaturePng(assemblePng(ih, chunk('IDAT', z.subarray(0, half)), chunk('tEXt', Buffer.from('x\0y')), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))))).toThrow(/inválida/i);
    expect(() => validateSignaturePng(assemblePng(ih, ih, chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))))).toThrow(/inválida/i);
    expect(() => validateSignaturePng(assemblePng(chunk('tEXt', Buffer.from('a\0b')), ih, chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))))).toThrow(/inválida/i);
  });
  it('rejeita arquivo que não é PNG, PNG truncado e PNG sem IDAT', () => {
    expect(() => validateSignaturePng(Buffer.from('GIF89a....'))).toThrow();
    expect(() => validateSignaturePng(strokePng().subarray(0, 40))).toThrow();
    expect(() => validateSignaturePng(strokePng().subarray(0, strokePng().length - 30))).toThrow();
    expect(() => validateSignaturePng(pngWithoutIdat())).toThrow(/inválida/i);
    expect(() => validateSignaturePng(Buffer.alloc(0))).toThrow();
  });
  it('rejeita dimensões acima do limite, abaixo do mínimo, cor/entrelaçamento diferentes', () => {
    expect(() => validateSignaturePng(makePng(1201, 100))).toThrow();
    expect(() => validateSignaturePng(makePng(300, 601))).toThrow();
    expect(() => validateSignaturePng(makePng(20, 10, () => [0, 0, 0, 255]))).toThrow();
    expect(() => validateSignaturePng(makePng(300, 100, () => [0, 0, 0, 255], { colorType: 2 }))).toThrow();
    expect(() => validateSignaturePng(makePng(300, 100, () => [0, 0, 0, 255], { interlace: 1 }))).toThrow();
  });
  it('rejeita bomba de descompressão e dados menores que o declarado', () => {
    const bomb = makePngFromRaw(300, 100, Buffer.alloc(60 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(MAX_SIGNATURE_BYTES);
    expect(() => validateSignaturePng(bomb)).toThrow(/inválida/i);
    expect(() => validateSignaturePng(makePngFromRaw(300, 100, Buffer.alloc(1000, 1)))).toThrow(/inválida/i);
  });
  it('rejeita arquivo maior que 200 KB', () => {
    expect(() => validateSignaturePng(Buffer.concat([strokePng(), Buffer.alloc(210 * 1024)]))).toThrow(/tamanho/i);
  });
  it('2000x1000 é rejeitado (teto 1200x600) e 1200x600 válido em menos de 200 ms', () => {
    const stroke = (W: number, H: number) => makePng(W, H, (x, y) => (x > 50 && x < W - 50 && Math.abs(y - H / 2 - Math.round((H / 5) * Math.sin(x / 90))) <= 3 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(() => validateSignaturePng(stroke(2000, 1000))).toThrow(/Dimensões/);
    const big = stroke(1200, 600);
    expect(big.length).toBeLessThanOrEqual(MAX_SIGNATURE_BYTES);
    const t0 = Date.now();
    const r = validateSignaturePng(big);
    const ms = Date.now() - t0;
    expect(r.width).toBe(1200);
    expect(r.height).toBe(600);
    expect(ms).toBeLessThan(200);
  });
});

// Propriedade de segurança: o que passa pelo validador (canonical) pode ser desenhado pelo pdfkit sem lançar nem derrubar o
// processo; o que seria perigoso (byte de filtro inválido faz o png-js lançar exceção não capturada em callback do zlib) é
// barrado ANTES de chegar ao pdfkit.
describe('canonical e pdfkit', () => {
  const draw = (img: Buffer) =>
    new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4' });
      const parts: Buffer[] = [];
      doc.on('data', (d: Buffer) => parts.push(d));
      doc.on('end', () => resolve(Buffer.concat(parts)));
      doc.on('error', reject);
      doc.image(img, 40, 40, { width: 200 });
      doc.end();
    });

  it('o canonical (de PNGs com filtros 0-4, tEXt e ruído) é desenhado pelo pdfkit sem exceção não capturada; o PDF é gerado', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      const inputs = [
        strokePng(), noisePng(224, 225), makeFilteredPng(300, 100, stroke, 3), makeFilteredPng(300, 100, stroke, 4),
        insertBeforeIend(makeFilteredPng(300, 100, stroke, 2), chunk('tEXt', Buffer.from('k\0v'))),
      ];
      for (const png of inputs) {
        const pdf = await draw(validateSignaturePng(png).canonical);
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      }
      await new Promise((r) => setTimeout(r, 50)); // dá chance a callbacks tardios do zlib
    } finally {
      process.off('uncaughtException', onUncaught);
    }
    expect(uncaught).toEqual([]);
  });

  it('o PNG com filtro 7 nunca chega ao pdfkit: o validador lança antes e nenhum canonical existe', () => {
    const hostile = makeFilteredPng(300, 100, stroke, 7);
    let canonical: Buffer | undefined;
    const drawSpy = jest.spyOn(PDFDocument.prototype as any, 'image');
    try {
      expect(() => { canonical = validateSignaturePng(hostile).canonical; }).toThrow(/inválida/i);
      expect(canonical).toBeUndefined();
      expect(drawSpy).not.toHaveBeenCalled();
    } finally {
      drawSpy.mockRestore();
    }
  });

  it('canônico acima de 256 KB é rejeitado com 400 mesmo com a entrada pequena (filtro Up esconde o ruído)', () => {
    // cada linha difere da anterior por uma constante: com o filtro Up a entrada comprime a quase nada,
    // mas o canônico (filtro 0) é incompressível (~720 KB para 600x300)
    const hostile = makeFilteredPng(600, 300, (x, y) => [(x * 13 + y * 37) & 255, (x * 7 + y * 91) & 255, (x * 29 + y * 53) & 255, 255], 2);
    expect(hostile.length).toBeLessThanOrEqual(MAX_SIGNATURE_BYTES);
    expect(() => validateSignaturePng(hostile)).toThrow(/acima do tamanho permitido/);
    expect(MAX_CANONICAL_BYTES).toBe(256 * 1024);
  });
});
