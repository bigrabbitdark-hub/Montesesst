import { deflateRawSync } from 'zlib';

// Bytes mínimos, porém com assinatura real — desde o ITEM 004 (auditoria
// 2026-09-27) o upload confere o CONTEÚDO contra o tipo declarado, então
// fixtures de imagem não podem mais ser texto qualquer ("fake-image-bytes").

// PNG 1x1 válido.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// JPEG mínimo: SOI + APP0 (JFIF) + EOI. Basta para a checagem de assinatura.
export const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xd9,
]);

// Variações com conteúdo distinto (testes que trocam/comparam o arquivo enviado).
export const tinyPngVariant = (marker: string): Buffer => Buffer.concat([TINY_PNG, Buffer.from(marker)]);
export const tinyJpegVariant = (marker: string): Buffer => Buffer.concat([TINY_JPEG, Buffer.from(marker)]);

export interface ZipEntrySpec {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  flags?: number;
  declaredUncompressed?: number; // para simular cabeçalho que mente sobre o tamanho
}

// ZIP mínimo escrito à mão (CRC fica 0: o utilitário não o verifica).
export function buildZip(entries: ZipEntrySpec[], opts: { totalOverride?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.declaredUncompressed ?? entry.data.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.totalOverride ?? entries.length, 8);
  eocd.writeUInt16LE(opts.totalOverride ?? entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

// DOCX que declara ser pequeno mas descompacta em `inflatedBytes` (zip bomb).
export function bombDocx(inflatedBytes: number): Buffer {
  return buildZip([
    { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
    { name: 'word/media/bomba.bin', data: Buffer.alloc(inflatedBytes) },
  ]);
}
