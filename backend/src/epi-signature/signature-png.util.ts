import { BadRequestException } from '@nestjs/common';
import { deflateSync, inflateSync } from 'zlib';
import { SIGNATURE_MAX_H, SIGNATURE_MAX_W } from '../common/pdf/safe-png.util';

export const MAX_SIGNATURE_BYTES = 200 * 1024;
export const MAX_CANONICAL_BYTES = 256 * 1024; // assinatura real tem ~6 KB; o canônico acima disso é recusado (400)
const MAX_W = SIGNATURE_MAX_W, MAX_H = SIGNATURE_MAX_H, MIN_W = 50, MIN_H = 30;
const MIN_VISIBLE_PIXELS = 20; // pixels com alfa >= 128
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32 próprio (não depende de zlib.crc32, que varia conforme a versão do Node).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Endpoint PÚBLICO: o arquivo enviado é tratado como hostil. Valida a estrutura inteira (chunks, CRC, nada após IEND),
// desfiltra todas as linhas (filtro inválido = 400; um filtro > 4 derrubaria o pdfkit/png-js) e REGRAVA um PNG canônico
// (filtro 0, só IHDR+IDAT+IEND). Quem grava no R2, hasheia ou desenha em PDF deve usar SEMPRE `canonical`, nunca os bytes enviados.
export function validateSignaturePng(buf: Buffer): { width: number; height: number; canonical: Buffer } {
  const bad = (m: string) => new BadRequestException(m);
  const invalid = () => bad('Imagem da assinatura inválida');
  if (buf.length > MAX_SIGNATURE_BYTES) throw bad('Imagem da assinatura acima do tamanho permitido');
  if (buf.length < 57 || !buf.subarray(0, 8).equals(SIG)) throw invalid();

  let off = 8, width = 0, height = 0, seenIhdr = false, ended = false, idatState: 0 | 1 | 2 = 0; // 0 antes, 1 em IDAT, 2 depois
  const idat: Buffer[] = [];
  let first = true;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len > buf.length || off + 12 + len > buf.length) throw invalid();
    const typeBuf = buf.subarray(off + 4, off + 8);
    const type = typeBuf.toString('latin1');
    if (!/^[A-Za-z]{4}$/.test(type)) throw invalid();
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) throw invalid();
    const data = buf.subarray(off + 8, off + 8 + len);
    if (first && type !== 'IHDR') throw invalid();
    first = false;
    if (type === 'IHDR') {
      if (seenIhdr || len !== 13) throw invalid();
      seenIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw bad('Imagem da assinatura em formato não aceito');
    } else if (type === 'IDAT') {
      if (idatState === 2) throw invalid(); // IDAT precisam ser contíguos
      idatState = 1;
      idat.push(data);
    } else if (type === 'IEND') {
      if (len !== 0) throw invalid();
      ended = true;
      off += 12;
      break;
    } else {
      const critical = (type.charCodeAt(0) & 0x20) === 0; // 1ª letra maiúscula = crítico
      if (critical || type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw bad('Imagem da assinatura em formato não aceito');
      if (idatState === 1) idatState = 2; // acessório entre IDATs quebra a contiguidade
      // acessório: ignorado (não vai para o canonical)
    }
    if (type !== 'IDAT' && idatState === 1) idatState = 2;
    off += 12 + len;
  }
  if (!seenIhdr || !ended || idat.length === 0 || off !== buf.length) throw invalid();
  if (width < MIN_W || height < MIN_H || width > MAX_W || height > MAX_H) throw bad('Dimensões da assinatura fora do permitido');

  const stride = 1 + width * 4;
  const expected = height * stride;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 16 });
  } catch {
    throw invalid();
  }
  if (raw.length !== expected) throw invalid();

  // desfiltra para pixels crus (w*4 por linha)
  const bpp = 4, rowBytes = width * 4;
  const px = Buffer.alloc(height * rowBytes);
  let visible = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    if (ft > 4) throw bad('Imagem da assinatura inválida');
    const src = y * stride + 1, dst = y * rowBytes, up = dst - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const b = y > 0 ? px[up + i] : 0;
      const c = i >= bpp && y > 0 ? px[up + i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        default: v = x + paeth(a, b, c);
      }
      px[dst + i] = v & 0xff;
    }
    for (let i = 3; i < rowBytes; i += 4) if (px[dst + i] >= 128) visible++;
  }
  if (visible === 0) throw bad('A assinatura está em branco');
  if (visible < MIN_VISIBLE_PIXELS) throw bad('A assinatura tem poucos pixels visíveis');

  // PNG canônico: filtro 0 em todas as linhas
  const out = Buffer.alloc(expected);
  for (let y = 0; y < height; y++) px.copy(out, y * stride + 1, y * rowBytes, (y + 1) * rowBytes);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const canonical = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
  if (canonical.length > MAX_CANONICAL_BYTES) throw bad('Imagem da assinatura acima do tamanho permitido');
  return { width, height, canonical };
}
