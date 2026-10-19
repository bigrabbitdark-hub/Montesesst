// Comprovante da assinatura eletrônica de recebimento de EPI (PDF, texto real e extraível).
// Gerado SOB DEMANDA a partir das COLUNAS já gravadas em epi_signatures (items_snapshot, evidence_sha256 etc.) e dos dados da empresa/funcionário.
// Atenção: ele LÊ e imprime evidence_sha256; NÃO o recalcula a partir de evidence_payload (a conferência é feita por quem recalcula o hash do payload):
// nada é guardado no R2 e a IMAGEM da assinatura NÃO é embutida (ela fica guardada à parte, identificada pelo seu hash).
// Cabeçalho, rodapé de marca e "Página X de Y" são desenhados em todas as páginas ao final (bufferPages).
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { brandFooterHeight, drawBrandFooter } from '../common/pdf/brand-footer.util';

export interface ReceiptItem {
  date: string; // AAAA-MM-DD
  epi_description: string;
  manufacturer: string | null;
  model: string | null;
  ca_number: string;
  quantity: number | null;
}

export interface ReceiptData {
  company: { name: string; cnpj: string };
  employee: { full_name: string; cpf_masked: string };
  receipt_code: string;
  signed_at: string; // ISO (instante da assinatura)
  items: ReceiptItem[];
  term: { version: string; draft: boolean; title: string; paragraphs: string[] };
  term_text_sha256?: string;
  evidence_sha256: string;
  signature_sha256: string;
  ip: string | null;
}

const LOGO = join(__dirname, '..', 'common', 'pdf', 'assets', 'montese-logo.png');
export const RECEIPT_DECLARATION =
  'Assinatura eletrônica simples, registrada com aceite explícito, código de confirmação e evidências técnicas; não é assinatura digital com certificado ICP-Brasil.';

// dd/mm/aaaa hh:mm em America/Sao_Paulo (o instante ISO fica na evidência).
function formatSaoPaulo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('buildReceiptPdf: signed_at inválido');
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const brDate = (ymd: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);

export function buildReceiptPdf(data: ReceiptData): Promise<Buffer> {
  let signedText: string;
  try { signedText = formatSaoPaulo(data.signed_at); } catch (err) { return Promise.reject(err); }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 95, bottom: Math.ceil(brandFooterHeight(595.28)) + 14, left: 40, right: 40 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const W = 515;

    const h = (t: string) => doc.moveDown(0.7).font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(t, left, undefined, { width: W });
    const body = (t: string, size = 9) => doc.font('Helvetica').fontSize(size).text(t, left, undefined, { width: W });

    doc.font('Helvetica-Bold').fontSize(14).text('COMPROVANTE DE ASSINATURA ELETRÔNICA', left, doc.y, { align: 'center', width: W });
    doc.font('Helvetica').fontSize(10).text('Recebimento de equipamentos de proteção individual (EPI)', left, doc.y, { align: 'center', width: W });
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(`Código do comprovante: ${data.receipt_code}`, left, doc.y, { width: W });
    body(`Assinado em ${signedText} (America/Sao_Paulo)`, 10);

    h('Empresa contratante');
    body(data.company.name);
    body(`CNPJ: ${data.company.cnpj}`);
    h('Colaborador');
    body(`Nome: ${data.employee.full_name}   CPF: ${data.employee.cpf_masked}`);

    h('Equipamentos recebidos');
    if (data.items.length === 0) body('Nenhum item registrado na evidência.');
    for (const it of data.items) {
      const eq = [it.epi_description, [it.manufacturer, it.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
      doc.moveDown(0.15);
      body(`${brDate(it.date)} — ${eq} — CA ${it.ca_number} — Qtd. ${it.quantity == null ? '—' : it.quantity}`, 8.5);
    }

    h(data.term.title);
    if (data.term.draft) body('RASCUNHO: o texto deste termo ainda não foi aprovado em versão definitiva (pendente de revisão).', 8.5);
    doc.font('Helvetica').fontSize(8.5);
    for (const p of data.term.paragraphs) doc.moveDown(0.3).text(p, left, undefined, { width: W });
    doc.moveDown(0.4).fontSize(8).text(`Versão do termo aceito: ${data.term.version}`, left, undefined, { width: W });

    h('Declaração');
    body(RECEIPT_DECLARATION);
    doc.moveDown(0.3);
    body('O colaborador marcou o aceite do termo e informou o código de confirmação do link de assinatura antes de desenhar a assinatura.', 8.5);

    h('Evidências técnicas');
    body('Hash da evidência (SHA-256 do payload JSON da evidência, gravado no momento da assinatura):', 8.5);
    doc.font('Courier').fontSize(8).text(data.evidence_sha256, left, undefined, { width: W });
    doc.moveDown(0.3);
    body('A imagem da assinatura é guardada separadamente; a evidência registra o seu hash (SHA-256 do arquivo de imagem):', 8.5);
    doc.font('Courier').fontSize(8).text(data.signature_sha256, left, undefined, { width: W });
    if (data.term_text_sha256) {
      doc.moveDown(0.3);
      body('Hash do texto do termo aceito (SHA-256):', 8.5);
      doc.font('Courier').fontSize(8).text(data.term_text_sha256, left, undefined, { width: W });
    }
    doc.moveDown(0.3);
    body(`Endereço IP de origem: ${data.ip ?? 'não registrado'}`, 8.5);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const saved = doc.page.margins.top;
      doc.page.margins.top = 0;
      doc.image(LOGO, 40, 22, { height: 40 });
      doc.font('Helvetica').fontSize(8).fillColor('#333333')
        .text(`${data.company.name} — CNPJ ${data.company.cnpj}`, 200, 30, { width: 355, align: 'right', lineBreak: false });
      doc.moveTo(40, 72).lineTo(555, 72).strokeColor('#0b6b3a').stroke().strokeColor('#000000');
      doc.page.margins.top = saved;
      drawBrandFooter(doc, { technicalLine: `Comprovante ${data.receipt_code} — Hash da evidência ${data.evidence_sha256.slice(0, 12)} — Página ${i + 1} de ${range.count}` });
    }
    doc.end();
  });
}
