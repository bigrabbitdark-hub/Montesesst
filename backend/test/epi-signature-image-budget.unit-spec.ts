import { createHash } from 'crypto';
import { ihdrSize, probeSafePng, SIGNATURE_MAX_H, SIGNATURE_MAX_W } from '../src/common/pdf/safe-png.util';
import { MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, MAX_TOTAL_PIXELS, selectImagesWithinBudget } from '../src/epi-ficha/signature-image-budget.util';
import { makePng, strokePng } from './helpers/png';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const read = (code: string, buf: Buffer | null, hash?: string) => ({ receipt_code: code, buf, signature_sha256: hash ?? (buf ? sha(buf) : 'x') });
// PNG canônico de cabeçalho válido, com preenchimento depois do IEND só para simular objetos grandes (o orçamento não decodifica)
const withHeader = (w: number, h: number, extra = 0) => Buffer.concat([makePng(w, h), Buffer.alloc(extra, 1)]);

describe('selectImagesWithinBudget e limites compartilhados', () => {
  it('as dimensões máximas são as mesmas do validador público e o probe usa o mesmo teto', () => {
    expect([SIGNATURE_MAX_W, SIGNATURE_MAX_H]).toEqual([1200, 600]);
    expect(probeSafePng(makePng(1200, 600))).toEqual({ width: 1200, height: 600 });
    expect(probeSafePng(makePng(1201, 600))).toBeNull();
    expect(probeSafePng(makePng(1200, 601))).toBeNull();
    expect(ihdrSize(strokePng())).toEqual({ width: 300, height: 100 });
    expect(ihdrSize(Buffer.alloc(10))).toBeNull();
  });

  it('inclui imagens íntegras dentro do orçamento', () => {
    const a = strokePng();
    const r = selectImagesWithinBudget([read('A', a), read('B', a)]);
    expect([...r.included.keys()]).toEqual(['A', 'B']);
    expect(r.unavailable).toEqual([]);
    expect(r.omitted).toEqual([]);
  });

  it('ausente, hash divergente e cabeçalho implausível ficam indisponíveis', () => {
    const a = strokePng();
    const r = selectImagesWithinBudget([read('A', null), read('B', a, 'f'.repeat(64)), read('C', Buffer.from('lixo'.repeat(30)))]);
    expect(r.unavailable).toEqual(['A', 'B', 'C']);
    expect(r.included.size).toBe(0);
  });

  it('objeto maior que 256 KB é indisponível ANTES do SHA-256 (mesmo com hash correto)', () => {
    const big = withHeader(300, 100, MAX_IMAGE_BYTES + 1);
    const r = selectImagesWithinBudget([read('A', big)]);
    expect(r.unavailable).toEqual(['A']);
  });

  it('12 megapixels somados: o excedente é "omitido" (não indisponível), e uma imagem menor depois ainda cabe', () => {
    const big = makePng(1200, 600); // 0,72 MP
    const n = Math.floor(MAX_TOTAL_PIXELS / (1200 * 600)); // 16
    const reads = Array.from({ length: n + 3 }, (_, i) => read(`B${i}`, big));
    reads.push(read('PEQ', strokePng())); // 0,03 MP: ainda cabe no que sobra? (16*0,72=11,52; sobra 0,48)
    const r = selectImagesWithinBudget(reads);
    expect(r.included.size).toBe(n + 1);
    expect(r.included.has('PEQ')).toBe(true);
    expect(r.omitted).toEqual(['B16', 'B17', 'B18']);
    expect(r.unavailable).toEqual([]);
  });

  it('8 MB lidos: passado o teto, o restante é omitido', () => {
    const each = withHeader(50, 30, 240 * 1024);
    expect(each.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const n = Math.floor(MAX_TOTAL_BYTES / each.length); // cabem n; a seguinte estoura
    const r = selectImagesWithinBudget(Array.from({ length: n + 2 }, (_, i) => read(`I${i}`, each)));
    expect(r.included.size).toBe(n);
    expect(r.omitted).toEqual([`I${n}`, `I${n + 1}`]);
  });
});
