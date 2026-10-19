import { inflateSync } from 'zlib';

// Teste de "decodificável com segurança" para PNG que será desenhado pelo pdfkit.
// O pdfkit decodifica PNG com RGBA de forma ASSÍNCRONA (zlib.inflate com callback) e LANÇA dentro do callback quando o
// fluxo zlib está corrompido, o filtro de linha é inválido ou as dimensões não casam: nenhum try/catch ao redor de
// doc.image() captura isso e o processo cai (uncaughtException). Por isso a imagem só é entregue ao pdfkit depois deste teste,
// que reproduz as mesmas condições de forma síncrona.
//
// ATENÇÃO: o CRC dos chunks NÃO é conferido aqui (nem pelo png-js). A integridade do conteúdo vem do hash SHA-256 do arquivo
// (conferido contra epi_signatures.signature_sha256 antes de chegar aqui) e do fato de o arquivo ser o canonical regravado pelo servidor.
// NÃO é a validação de entrada (validateSignaturePng, limite de 200 KB): aqui o formato é o do PNG CANÔNICO que o serviço
// público grava (IHDR + IDAT + IEND, 8 bits RGBA, sem entrelaçamento) e o tamanho pode chegar a ~1 MB.
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Dimensões máximas da assinatura: UMA constante só, usada pelo validador público (entrada) e por este teste (saída).
// A página de assinatura desenha o canvas com tamanho interno fixo 600x200, então o teto é folgado.
export const SIGNATURE_MAX_W = 1200;
export const SIGNATURE_MAX_H = 600;
const MAX_W = SIGNATURE_MAX_W;
const MAX_H = SIGNATURE_MAX_H;

export function probeSafePng(buf: Buffer | null | undefined): { width: number; height: number } | null {
  try {
    if (!buf || buf.length < 57 || !buf.subarray(0, 8).equals(SIG)) return null;
    let off = 8;
    let width = 0;
    let height = 0;
    let seenIhdr = false;
    let ended = false;
    const idat: Buffer[] = [];
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off);
      if (off + 12 + len > buf.length) return null;
      const type = buf.subarray(off + 4, off + 8).toString('latin1');
      const data = buf.subarray(off + 8, off + 8 + len);
      if (!seenIhdr && type !== 'IHDR') return null;
      if (type === 'IHDR') {
        if (seenIhdr || len !== 13) return null;
        seenIhdr = true;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        // só o formato canônico: 8 bits, RGBA, compressão/filtro padrão, sem entrelaçamento
        if (data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
        if (width < 1 || height < 1 || width > MAX_W || height > MAX_H) return null;
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        if (len !== 0) return null;
        ended = true;
        off += 12;
        break;
      } else {
        return null; // o canônico só tem IHDR, IDAT e IEND
      }
      off += 12 + len;
    }
    if (!seenIhdr || !ended || idat.length === 0 || off !== buf.length) return null;

    const stride = 1 + width * 4;
    const expected = height * stride;
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 16 });
    if (raw.length !== expected) return null;
    for (let y = 0; y < height; y++) if (raw[y * stride] > 4) return null; // filtro inválido derrubaria o png-js
    return { width, height };
  } catch {
    return null;
  }
}

// Largura/altura lidas do IHDR de um PNG canônico (sem decodificar). null se o cabeçalho não for plausível.
export function ihdrSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG) || buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width >= 1 && height >= 1 && width <= MAX_W && height <= MAX_H ? { width, height } : null;
}
