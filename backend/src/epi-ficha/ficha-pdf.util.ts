// PDF da ficha de controle de EPI (texto real, extraível; imagens de assinatura só no anexo da emissão, quando há evidência). Cabeçalho, marca d'água e rodapé
// de marca são desenhados em todas as páginas ao final (bufferPages), para que "Página X de Y" seja correto.
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { brandFooterHeight, drawBrandFooter } from '../common/pdf/brand-footer.util';
import { probeSafePng } from '../common/pdf/safe-png.util';
import { RECEIPT_DECLARATION } from '../epi-signature/receipt-pdf.util';
import { Ficha, FichaLine } from './epi-ficha.types';

// Limite de imagens de assinatura no anexo (acima disso lista só código e data).
export const MAX_SIGNATURE_IMAGES = 100;
const IMG_MAX_W = 220;
const IMG_MAX_H = 90;

export interface FichaPdfMeta {
  preview: boolean;
  documentCode?: string;
  version?: number;
  issuedAt?: string;
  snapshotHash?: string;
  // receipt_code das assinaturas íntegras que ficaram de fora do orçamento do documento (megapixels/bytes)
  omittedImages?: string[];
}

const LOGO = join(__dirname, '..', 'common', 'pdf', 'assets', 'montese-logo.png');
const SIGNATURE_LABEL: Record<string, string> = {
  pendente: 'Pendente', assinada: 'Assinada', recusada: 'Recusada', expirada: 'Expirada',
  presencial: 'Registrada presencialmente', legado: 'Histórico anterior ao módulo', estornada: 'Estornada',
};
const TYPE_LABEL: Record<string, string> = {
  entrega: 'Entrega', troca: 'Troca', devolucao: 'Devolução', estorno: 'Estorno', entrega_legada: 'Entrega (histórico anterior ao módulo)',
};
const COLS = [
  { key: 'date', label: 'Data', w: 58 },
  { key: 'epi', label: 'Equipamento', w: 150 },
  { key: 'ca', label: 'CA', w: 44 },
  { key: 'qty', label: 'Qtd.', w: 30 },
  { key: 'mov', label: 'Movimento / motivo', w: 98 },
  { key: 'sig', label: 'Assinatura', w: 135 },
] as const;

// Data/hora de emissão para leitura humana: dd/mm/aaaa hh:mm em America/Sao_Paulo (o ISO fica no instantâneo e no banco).
function formatIssuedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('buildFichaPdf: meta.issuedAt inválido');
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// dd/mm/aaaa hh:mm em America/Sao_Paulo; null se a data for inválida (a linha cai para o texto sem data).
function formatLocal(iso: string | null | undefined): string | null {
  try { return iso ? formatIssuedAt(iso) : null; } catch { return null; }
}

// `signatureImages`: imagens CANÔNICAS já conferidas (hash) pelo chamador, por receipt_code. A prévia não passa imagens.
export function buildFichaPdf(ficha: Ficha, meta: FichaPdfMeta, signatureImages?: Map<string, Buffer>): Promise<Buffer> {
  // Documento emitido sempre carrega identificação completa: falta de dado é erro de programação, nunca "undefined" no PDF.
  if (!meta.preview) {
    for (const campo of ['documentCode', 'version', 'issuedAt', 'snapshotHash'] as const) {
      if (meta[campo] === undefined || meta[campo] === null || meta[campo] === '') {
        return Promise.reject(new Error(`buildFichaPdf: meta.${campo} é obrigatório quando preview=false`));
      }
    }
  }
  let issuedAtText = '';
  if (!meta.preview) {
    try { issuedAtText = formatIssuedAt(meta.issuedAt as string); } catch (err) { return Promise.reject(err); }
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 95, bottom: Math.ceil(brandFooterHeight(595.28)) + 14, left: 40, right: 40 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

    // 1) Identificação
    doc.font('Helvetica-Bold').fontSize(14).text('FICHA DE CONTROLE DE EPI', { align: 'center' });
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Empresa contratante');
    doc.font('Helvetica').fontSize(9)
      .text(`${ficha.company.name}${ficha.company.trade_name ? ` (${ficha.company.trade_name})` : ''}`)
      .text(`CNPJ: ${ficha.company.cnpj}`).text(`Endereço: ${ficha.company.address}`);
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Colaborador');
    const e = ficha.employee;
    doc.font('Helvetica').fontSize(9)
      .text(`Nome: ${e.full_name}   CPF: ${e.cpf_masked}`)
      .text(`Matrícula: ${e.registration_number ?? 'não informada'}   Setor: ${e.department ?? 'não informado'}   Função: ${e.position ?? 'não informada'}`)
      .text(`Admissão: ${e.admission_date ?? 'não informada'}   Situação: ${e.status}${e.company_unit_name ? `   Unidade: ${e.company_unit_name}` : ''}`);
    doc.moveDown(0.8);

    // 2) Histórico (tabela com quebra de página e cabeçalho repetido)
    const drawHeader = () => {
      let x = left;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      for (const c of COLS) { doc.text(c.label, x, y, { width: c.w - 4 }); x += c.w; }
      doc.moveTo(left, y + 11).lineTo(left + COLS.reduce((s, c) => s + c.w, 0), y + 11).stroke();
      doc.y = y + 14;
    };
    doc.font('Helvetica-Bold').fontSize(10).text('Histórico de equipamentos', left, doc.y);
    doc.moveDown(0.3);
    drawHeader();
    if (ficha.lines.length === 0) {
      doc.font('Helvetica').fontSize(9).text('Nenhuma movimentação registrada no período.', left);
    }
    for (const l of ficha.lines) {
      const cells = rowCells(l);
      doc.font('Helvetica').fontSize(8);
      const h = Math.max(...COLS.map((c, i) => doc.heightOfString(cells[i], { width: c.w - 4 }))) + 4;
      if (doc.y + h > bottomLimit()) { doc.addPage(); drawHeader(); }
      doc.font('Helvetica').fontSize(8); // drawHeader deixa a fonte em negrito
      let x = left;
      const y = doc.y;
      COLS.forEach((c, i) => { doc.text(cells[i], x, y, { width: c.w - 4 }); x += c.w; });
      doc.y = y + h;
    }

    // 3) Termo
    if (doc.y + 120 > bottomLimit()) doc.addPage();
    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text(ficha.term.title, left);
    doc.font('Helvetica').fontSize(8.5);
    for (const p of ficha.term.paragraphs) doc.moveDown(0.3).text(p, left, undefined, { width: 515 });
    doc.moveDown(0.6).fontSize(8)
      .text(`Versão do termo: ${ficha.term.version}${ficha.term.draft ? ' (texto em rascunho, pendente de revisão)' : ''}`);
    doc.moveDown(0.4).text('A situação de assinatura de cada entrega consta na coluna "Assinatura". Não há assinatura eletrônica registrada além da indicada em cada linha.');

    // 3b) Anexo "Comprovantes de assinatura": só existe se houver evidência eletrônica.
    const sigs = ficha.signatures ?? [];
    if (sigs.length > 0) {
      const textW = 515;
      const omitted = new Set(meta.omittedImages ?? []);
      if (doc.y + 150 > bottomLimit()) doc.addPage();
      doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Comprovantes de assinatura', left, doc.y, { width: textW });
      doc.moveDown(0.3).font('Helvetica').fontSize(8)
        .text(`${RECEIPT_DECLARATION} A imagem é a assinatura desenhada pelo colaborador, guardada separadamente; o hash SHA-256 de cada imagem consta abaixo.`, left, undefined, { width: textW });
      if (meta.preview) {
        doc.moveDown(0.3).text('Prévia: as imagens das assinaturas não são lidas nem exibidas; constam apenas o código e a data. Elas são incluídas na emissão.', left, undefined, { width: textW });
      } else if (sigs.length > MAX_SIGNATURE_IMAGES) {
        doc.moveDown(0.3).text(`Foram incluídas as imagens das ${MAX_SIGNATURE_IMAGES} primeiras assinaturas; as demais ${sigs.length - MAX_SIGNATURE_IMAGES} listam apenas código e data (limite de ${MAX_SIGNATURE_IMAGES} imagens por documento).`, left, undefined, { width: textW });
      }
      if (!meta.preview && omitted.size > 0) {
        doc.moveDown(0.3).text(`${omitted.size} imagem(ns) não incluída(s) por exceder o limite de tamanho total do documento; constam código e data.`, left, undefined, { width: textW });
      }
      doc.moveDown(0.5);
      sigs.forEach((sg, idx) => {
        const when = formatLocal(sg.signed_at);
        const title = `Comprovante ${sg.receipt_code}${when ? ` — assinada em ${when} (America/Sao_Paulo)` : ''}`;
        // Só desenha a imagem que o chamador entregou E que é um PNG canônico decodificável com segurança (ver probeSafePng).
        const wantImage = !meta.preview && idx < MAX_SIGNATURE_IMAGES;
        const buf = wantImage ? signatureImages?.get(sg.receipt_code) : undefined;
        const dims = buf ? probeSafePng(buf) : null;
        let dw = 0;
        let dh = 0;
        if (dims) {
          dw = Math.min(IMG_MAX_W, dims.width);
          dh = (dw * dims.height) / dims.width;
          if (dh > IMG_MAX_H) { dh = IMG_MAX_H; dw = (dh * dims.width) / dims.height; }
        }
        const need = (dims ? 12 * 3 + dh + 20 : 12 * 2) + 6;
        if (doc.y + need > bottomLimit()) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000').text(title, left, doc.y, { width: textW });
        if (dims && buf) {
          doc.font('Courier').fontSize(7)
            .text(`Hash da evidência: ${sg.evidence_sha256}`, left, undefined, { width: textW })
            .text(`Hash da imagem:    ${sg.signature_sha256}`, left, undefined, { width: textW });
          const bx = left;
          const by = doc.y + 4;
          // fundo branco com borda: a imagem é um traço preto sobre transparência
          doc.save().rect(bx, by, dw + 8, dh + 8).fillAndStroke('#ffffff', '#999999').restore();
          let drawn = true;
          try {
            doc.image(buf, bx + 4, by + 4, { width: dw, height: dh });
          } catch {
            drawn = false;
          }
          doc.fillColor('#000000').strokeColor('#000000');
          doc.y = by + dh + 8 + 6;
          if (!drawn) doc.font('Helvetica').fontSize(8).text('(imagem indisponível/divergente)', left, doc.y, { width: textW });
        } else if (wantImage && omitted.has(sg.receipt_code)) {
          doc.font('Helvetica').fontSize(8).text('(imagem não incluída (limite do documento))', left, undefined, { width: textW });
        } else if (wantImage) {
          doc.font('Helvetica').fontSize(8).text('(imagem indisponível/divergente)', left, undefined, { width: textW });
        }
        doc.moveDown(0.5);
      });
    }

    // 4) Cabeçalho, marca d'água e rodapé em todas as páginas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const saved = doc.page.margins.top;
      doc.page.margins.top = 0;
      doc.image(LOGO, 40, 22, { height: 40 });
      doc.font('Helvetica').fontSize(8).fillColor('#333333')
        .text(`${ficha.company.name} — CNPJ ${ficha.company.cnpj}`, 200, 30, { width: 355, align: 'right', lineBreak: false });
      doc.moveTo(40, 72).lineTo(555, 72).strokeColor('#0b6b3a').stroke().strokeColor('#000000');
      doc.page.margins.top = saved;
      if (meta.preview) {
        doc.save().fillOpacity(0.08).fillColor('#000000').font('Helvetica-Bold').fontSize(70)
          .rotate(-35, { origin: [297, 420] }).text('NÃO EMITIDO', 90, 380, { lineBreak: false }).restore();
      }
      const tech = meta.preview
        ? `Prévia não emitida — Página ${i + 1} de ${range.count}`
        : `${meta.documentCode} — Versão ${meta.version} — Emitido em ${issuedAtText} — Hash do instantâneo ${(meta.snapshotHash as string).slice(0, 12)} — Página ${i + 1} de ${range.count}`;
      drawBrandFooter(doc, { technicalLine: tech });
    }
    doc.end();
  });
}

function signatureCell(l: FichaLine): string {
  if (!l.signature_status) return '—';
  if (l.signature_status === 'assinada' && l.receipt_code) {
    const when = formatLocal(l.signed_at);
    // quebras explícitas: o fuso e o código nunca são partidos no meio pela quebra automática da coluna estreita
    return `Assinada eletronicamente${when ? ` em ${when}\n(America/Sao_Paulo)` : ''} — comprovante\n${l.receipt_code}`;
  }
  return SIGNATURE_LABEL[l.signature_status] ?? l.signature_status;
}

function rowCells(l: FichaLine): string[] {
  const equip = [l.epi_description, [l.manufacturer, l.model].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  const mov = `${TYPE_LABEL[l.type] ?? l.type}${l.reversed ? ' (ESTORNADA)' : ''}${l.reason ? `\n${l.reason}` : ''}`;
  return [l.date, equip, l.ca_number, l.quantity == null ? '—' : String(l.quantity), mov, signatureCell(l)];
}
