import { verifyFileContent } from '../src/common/files/file-content.util';
import { DOCX_MIME_TYPE } from '../src/common/docx/docx-text.util';
import { XLSX_MIME_TYPE } from '../src/common/xlsx/xlsx-text.util';
import { TINY_JPEG, TINY_PNG, ZipEntrySpec, buildZip } from './file-fixtures';

// ITEM 004 (auditoria 2026-09-27): o tipo do upload passa a ser conferido
// pelo CONTEÚDO, não só pelo Content-Type declarado pelo cliente.

const docx = (extra: ZipEntrySpec[] = []) =>
  buildZip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>') }, ...extra]);

describe('verifyFileContent — assinatura de PDF/PNG/JPEG', () => {
  it('aceita PDF real', async () => {
    expect(await verifyFileContent(Buffer.from('%PDF-1.4\n1 0 obj'), 'application/pdf')).toBeNull();
  });
  it('aceita PDF com lixo antes do cabeçalho (dentro dos primeiros 1024 bytes)', async () => {
    expect(await verifyFileContent(Buffer.from('\n\n  ﻿%PDF-1.7 corpo'), 'application/pdf')).toBeNull();
  });
  it('recusa cabeçalho %PDF- além dos primeiros 1024 bytes', async () => {
    const late = Buffer.concat([Buffer.alloc(2000, 0x20), Buffer.from('%PDF-1.4')]);
    expect(await verifyFileContent(late, 'application/pdf')).not.toBeNull();
  });
  it('recusa HTML/script declarado como PDF', async () => {
    expect(await verifyFileContent(Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf')).toContain(
      'PDF',
    );
  });
  it('recusa executável (MZ) declarado como PDF', async () => {
    expect(await verifyFileContent(Buffer.from('MZ\x90\x00\x03'), 'application/pdf')).not.toBeNull();
  });
  it('recusa buffer vazio', async () => {
    expect(await verifyFileContent(Buffer.alloc(0), 'application/pdf')).not.toBeNull();
    expect(await verifyFileContent(Buffer.alloc(0), 'image/png')).not.toBeNull();
  });
  it('aceita PNG e JPEG reais, e recusa um declarado como o outro', async () => {
    expect(await verifyFileContent(TINY_PNG, 'image/png')).toBeNull();
    expect(await verifyFileContent(TINY_JPEG, 'image/jpeg')).toBeNull();
    expect(await verifyFileContent(TINY_PNG, 'image/jpeg')).not.toBeNull();
    expect(await verifyFileContent(TINY_JPEG, 'image/png')).not.toBeNull();
  });
  it('recusa SVG/GIF declarados como imagem permitida', async () => {
    expect(await verifyFileContent(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).not.toBeNull();
    expect(await verifyFileContent(Buffer.from('GIF89a......'), 'image/jpeg')).not.toBeNull();
  });
  it('tipo fora da lista não passa', async () => {
    expect(await verifyFileContent(Buffer.from('%PDF-1.4'), 'text/html')).toBe('Tipo de arquivo não suportado');
  });
});

describe('verifyFileContent — DOCX/XLSX (ZIP)', () => {
  it('aceita DOCX com word/document.xml', async () => {
    expect(await verifyFileContent(docx(), DOCX_MIME_TYPE)).toBeNull();
  });
  it('aceita XLSX real gerado pelo exceljs', async () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Aba').addRow(['Função', 'Medição']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(await verifyFileContent(buffer, XLSX_MIME_TYPE)).toBeNull();
  });
  it('recusa DOCX declarado mas com conteúdo de XLSX (e vice-versa)', async () => {
    const xlsxLike = buildZip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }]);
    expect(await verifyFileContent(xlsxLike, DOCX_MIME_TYPE)).not.toBeNull();
    expect(await verifyFileContent(docx(), XLSX_MIME_TYPE)).not.toBeNull();
  });
  it('recusa ZIP qualquer (sem as entradas de Office)', async () => {
    expect(await verifyFileContent(buildZip([{ name: 'malware.exe', data: Buffer.from('MZ') }]), DOCX_MIME_TYPE)).not.toBeNull();
  });
  it('recusa arquivo que só começa com PK mas não é um ZIP íntegro', async () => {
    expect(await verifyFileContent(Buffer.from('PK\x03\x04 lixo sem diretorio central'), DOCX_MIME_TYPE)).not.toBeNull();
  });
  it('recusa entrada criptografada', async () => {
    expect(await verifyFileContent(docx([{ name: 'x.bin', data: Buffer.from('a'), flags: 1 }]), DOCX_MIME_TYPE)).not.toBeNull();
  });
  it('recusa método de compressão desconhecido', async () => {
    const zip = docx();
    // troca o método (8) da entrada única no cabeçalho central por 99
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(99, cdOffset + 10);
    expect(await verifyFileContent(zip, DOCX_MIME_TYPE)).not.toBeNull();
  });
  it('recusa quando o número de entradas passa do limite', async () => {
    const many = buildZip(Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('a') })).concat([
      { name: 'word/document.xml', data: Buffer.from('<w/>') },
    ]));
    expect(await verifyFileContent(many, DOCX_MIME_TYPE, { maxEntries: 10, maxEntryBytes: 1e6, maxTotalBytes: 1e7 })).not.toBeNull();
  });

  describe('zip bomb', () => {
    const limits = { maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 };

    it('recusa entrada que descompacta além do teto (5 MB de zeros cabem em poucos KB)', async () => {
      const bomb = docx([{ name: 'word/media/bomba.bin', data: Buffer.alloc(5 * 1024 * 1024) }]);
      expect(bomb.length).toBeLessThan(20 * 1024); // o arquivo enviado é minúsculo
      expect(await verifyFileContent(bomb, DOCX_MIME_TYPE, limits)).not.toBeNull();
    });
    it('recusa quando o CABEÇALHO MENTE sobre o tamanho (declara 10 bytes, entrega 5 MB)', async () => {
      const liar = docx([{ name: 'word/media/mentira.bin', data: Buffer.alloc(5 * 1024 * 1024), declaredUncompressed: 10 }]);
      expect(await verifyFileContent(liar, DOCX_MIME_TYPE, limits)).not.toBeNull();
    });
    it('recusa quando a SOMA das entradas passa do teto total, mesmo com cada uma abaixo do teto por entrada', async () => {
      const parts = [1, 2, 3].map((i) => ({ name: `word/p${i}.bin`, data: Buffer.alloc(900 * 1024) }));
      expect(await verifyFileContent(docx(parts), DOCX_MIME_TYPE, limits)).not.toBeNull();
    });
    it('aceita arquivo grande porém dentro dos tetos', async () => {
      const ok = docx([{ name: 'word/media/imagem.bin', data: Buffer.alloc(500 * 1024, 7) }]);
      expect(await verifyFileContent(ok, DOCX_MIME_TYPE, limits)).toBeNull();
    });
  });
});
