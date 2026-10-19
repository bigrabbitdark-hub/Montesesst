import { deflateSync } from 'zlib';

// Gerador de PNG para testes, sem dependências. Só para os testes de assinatura eletrônica.
const CRC_TABLE = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function ihdrOf(w: number, h: number, colorType: number, interlace: number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[12] = interlace;
  return ihdr;
}

// pixel(x,y) devolve [r,g,b,a]; padrão = transparente (canvas em branco)
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number] = () => [0, 0, 0, 0], opts: { colorType?: number; interlace?: number } = {}): Buffer {
  const colorType = opts.colorType ?? 6;
  const bpp = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(h * (1 + w * bpp));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * bpp)] = 0; for (let x = 0; x < w; x++) { const p = pixel(x, y); for (let i = 0; i < bpp; i++) raw[y * (1 + w * bpp) + 1 + x * bpp + i] = p[i]; } }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdrOf(w, h, colorType, opts.interlace ?? 0)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// PNG com cabeçalho RGBA 8 bits mas dados brutos arbitrários (bomba de descompressão, tamanho incoerente).
export function makePngFromRaw(w: number, h: number, raw: Buffer): Buffer {
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdrOf(w, h, 6, 0)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// PNG sem nenhum chunk IDAT (só IHDR e IEND), com tamanho acima do mínimo do validador.
export function pngWithoutIdat(w = 300, h = 100): Buffer {
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdrOf(w, h, 6, 0)), chunk('tEXt', Buffer.alloc(40, 0x61)), chunk('IEND', Buffer.alloc(0))]);
}

export const strokePng = (w = 300, h = 100) => makePng(w, h, (x, y) => (Math.abs(y - 50 - Math.round(20 * Math.sin(x / 15))) <= 2 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
export const blankPng = (w = 300, h = 100) => makePng(w, h);

// PNG válido de ruído pseudoaleatório (incompressível), perto do teto de 200 KB. Determinístico.
export function noisePng(w: number, h: number): Buffer {
  let s = 123456789;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
  return makePng(w, h, () => [rnd(), rnd(), rnd(), rnd() | 1]);
}

export const IHDR_OF = ihdrOf;

// Monta um PNG a partir de chunks já prontos (para casos hostis: acessórios, críticos desconhecidos, lixo após IEND...).
export const assemblePng = (...chunks: Buffer[]) => Buffer.concat([PNG_SIG, ...chunks]);

const paethP = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// PNG RGBA com filtro REAL por linha (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). `filter` pode ser uma função da linha;
// valores > 4 geram o byte de filtro inválido (os dados ficam como estão).
export function makeFilteredPng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number], filter: number | ((y: number) => number)): Buffer {
  const rowBytes = w * 4;
  const px = Buffer.alloc(h * rowBytes);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pixel(x, y); for (let i = 0; i < 4; i++) px[y * rowBytes + x * 4 + i] = p[i]; }
  const raw = Buffer.alloc(h * (1 + rowBytes));
  for (let y = 0; y < h; y++) {
    const f = typeof filter === 'number' ? filter : filter(y);
    raw[y * (1 + rowBytes)] = f;
    for (let i = 0; i < rowBytes; i++) {
      const cur = px[y * rowBytes + i];
      const a = i >= 4 ? px[y * rowBytes + i - 4] : 0;
      const b = y > 0 ? px[(y - 1) * rowBytes + i] : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * rowBytes + i - 4] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1; else if (f === 4) pred = paethP(a, b, c);
      raw[y * (1 + rowBytes) + 1 + i] = (cur - pred) & 0xff;
    }
  }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdrOf(w, h, 6, 0)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Pixels RGBA decodificados de um PNG sem filtro (filtro 0), para comparar o canonical com o original.
export function decodeUnfilteredPixels(png: Buffer): { w: number; h: number; px: Buffer } {
  const { inflateSync } = require('zlib');
  let off = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (off + 12 <= png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('latin1', off + 4, off + 8);
    if (type === 'IHDR') { w = png.readUInt32BE(off + 8); h = png.readUInt32BE(off + 12); }
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw: Buffer = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { if (raw[y * (1 + w * 4)] !== 0) throw new Error('canonical com filtro != 0'); raw.copy(px, y * w * 4, y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)); }
  return { w, h, px };
}

export const chunkTypesOf = (png: Buffer): string[] => {
  const t: string[] = []; let off = 8;
  while (off + 12 <= png.length) { const len = png.readUInt32BE(off); t.push(png.toString('latin1', off + 4, off + 8)); off += 12 + len; }
  return t;
};
