import { createInflateRaw } from 'zlib';
import { DOCX_MIME_TYPE } from '../docx/docx-text.util';
import { XLSX_MIME_TYPE } from '../xlsx/xlsx-text.util';

// ITEM 004 (auditoria 2026-09-27): até aqui todo upload confiava no
// Content-Type declarado pelo cliente (multer o copia do cabeçalho multipart,
// controlado por quem envia). Este utilitário confere o CONTEÚDO real contra
// o tipo declarado, sem dependência nova (são só 5 formatos).
//
// Limites, para não passar falsa sensação de segurança:
// - Assinatura correta NÃO prova que o arquivo é inofensivo (um PDF válido
//   pode carregar conteúdo ativo; só um antivírus enxerga isso).
// - Para DOCX/XLSX (ZIP), além do nome das entradas, a descompressão é
//   realmente executada em fluxo (memória constante) até um teto, porque o
//   tamanho declarado no cabeçalho do ZIP é controlado pelo atacante.

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const MB = 1024 * 1024;
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 200 * MB,
  maxTotalBytes: 300 * MB,
};

// Tipos aceitos em uploads de foto/logo (mesma restrição dos inputs do frontend).
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];

const PNG_SIGNATURE =Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50;
const ZIP_MAX_COMMENT = 0xffff;

const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  [DOCX_MIME_TYPE]: 'DOCX',
  [XLSX_MIME_TYPE]: 'XLSX',
};

const OFFICE_REQUIRED_ENTRY: Record<string, string> = {
  [DOCX_MIME_TYPE]: 'word/document.xml',
  [XLSX_MIME_TYPE]: 'xl/workbook.xml',
};

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
  encrypted: boolean;
}

type ZipParse = { ok: true; entries: ZipEntry[] } | { ok: false };

function parseZipDirectory(buffer: Buffer, limits: ZipLimits): ZipParse {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== ZIP_LOCAL_HEADER) return { ok: false };

  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 22 - ZIP_MAX_COMMENT);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return { ok: false };

  const total = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 (marcadores 0xFFFF/0xFFFFFFFF): nenhum DOCX/XLSX legítimo sob o
  // limite de upload precisa disso.
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false };
  if (total > limits.maxEntries) return { ok: false };

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== ZIP_CENTRAL_HEADER) return { ok: false };
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > buffer.length) return { ok: false };
    entries.push({
      name: buffer.toString('utf8', pos + 46, pos + 46 + nameLen),
      method,
      compressedSize,
      localOffset,
      encrypted: (flags & 0x1) !== 0,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries };
}

function entryData(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const lo = entry.localOffset;
  if (lo + 30 > buffer.length || buffer.readUInt32LE(lo) !== ZIP_LOCAL_HEADER) return null;
  const start = lo + 30 + buffer.readUInt16LE(lo + 26) + buffer.readUInt16LE(lo + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) return null;
  return buffer.subarray(start, end);
}

// Descomprime descartando a saída; resolve com o tamanho real, ou -1 se passar
// do teto (interrompendo na hora — nunca materializa o conteúdo inteiro).
function inflatedSizeUpTo(data: Buffer, cap: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    let size = 0;
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    inflate.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        inflate.destroy();
        done(-1);
      }
    });
    inflate.on('end', () => done(size));
    inflate.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    inflate.end(data);
  });
}

async function verifyOfficeZip(buffer: Buffer, mimetype: string, limits: ZipLimits): Promise<boolean> {
  const parsed = parseZipDirectory(buffer, limits);
  if (!parsed.ok) return false;
  if (!parsed.entries.some((entry) => entry.name === OFFICE_REQUIRED_ENTRY[mimetype])) return false;

  let totalBytes = 0;
  for (const entry of parsed.entries) {
    if (entry.encrypted) return false;
    const data = entryData(buffer, entry);
    if (!data) return false;

    let actual: number;
    if (entry.method === 0) {
      actual = data.length;
    } else if (entry.method === 8) {
      try {
        actual = await inflatedSizeUpTo(data, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - totalBytes));
      } catch {
        return false;
      }
      if (actual === -1) return false;
    } else {
      return false;
    }
    totalBytes += actual;
    if (actual > limits.maxEntryBytes || totalBytes > limits.maxTotalBytes) return false;
  }
  return true;
}

function matchesSignature(buffer: Buffer, mimetype: string): boolean {
  switch (mimetype) {
    case 'application/pdf':
      // A especificação tolera lixo antes de "%PDF-" nos primeiros 1024 bytes.
      return buffer.subarray(0, 1024).includes('%PDF-');
    case 'image/png':
      return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    default:
      return false;
  }
}

// Devolve null se o conteúdo confere com o tipo declarado, ou a mensagem de
// erro (pt-BR, pronta pra BadRequestException) se não confere.
export async function verifyFileContent(
  buffer: Buffer,
  mimetype: string,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Promise<string | null> {
  const label = TYPE_LABEL[mimetype];
  if (!label) return 'Tipo de arquivo não suportado';
  const mismatch = `O conteúdo do arquivo não corresponde ao tipo informado (${label}) — envie o arquivo original`;

  if (mimetype === DOCX_MIME_TYPE || mimetype === XLSX_MIME_TYPE) {
    return (await verifyOfficeZip(buffer, mimetype, limits)) ? null : mismatch;
  }
  return matchesSignature(buffer, mimetype) ? null : mismatch;
}
