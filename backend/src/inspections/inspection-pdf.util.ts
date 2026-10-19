import { join } from 'path';
import PDFDocument from 'pdfkit';
import type PDFKit from 'pdfkit';
import { InspectionDetail } from './inspections.service';
import { CHECKLIST_ITEMS } from './checklist-items.const';

interface InspectionPdfContext {
  tenantName: string;
  tenantCnpj: string;
  companyUnitAddress: string | null;
}

const BLOCK_LABELS: Record<string, string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const STATUS_LABELS: Record<string, string> = { C: 'Conforme', NC: 'Não conforme', NA: 'Não se aplica' };

// Identidade visual oficial dos documentos da Montese
// (docs/reference/identidade-documentos-oficiais/). A `marca-dagua`
// (PNG RGBA, 375x275) é centralizada em cada página com opacidade
// reduzida — fica visível nos espaços em branco mas não compete com
// o texto. O `rodape` (PNG RGB, 2000x420) é uma faixa decorativa
// colada no rodapé de cada página, alinhada à largura útil. Em
// produção, esses PNGs são versionados em `backend/src/inspections/
// assets/` ao lado do util que os consome — o PDF gerado fica
// autocontido (sem dependência de arquivos fora do repo) e o
// pipeline de CI/test não precisa de paths absolutos.
const WATERMARK_PATH = join(__dirname, 'assets', 'marca-dagua-montese.png');
const FOOTER_PATH = join(__dirname, 'assets', 'rodape-montese.png');

// Dimensões de referência das imagens — usadas pra calcular
// posicionamento proporcional sem inspecionar o PNG em runtime.
// Marca d'água: ocupa ~40% da largura útil, centralizada.
// Rodapé: 100% da largura útil, fixo no rodapé com 1.2cm de folga.
const WATERMARK_TARGET_WIDTH = 220; // pontos (~7.8cm)
const FOOTER_TARGET_HEIGHT = 36; // pontos (~1.3cm)
const FOOTER_BOTTOM_MARGIN = 28; // pontos (~1cm do fundo)

// inspection.visited_at (e plan.deadline) são colunas DATE — node-pg
// devolve isso como objeto Date bruto quando lido fora de um contexto
// que passa por JSON.stringify. Interpolar um Date bruto aqui produziria
// "Tue Sep 15 2026 00:00:00 GMT..." em vez de "2026-09-15" — mesma
// armadilha já documentada em ata-pdf.util.ts (committees.service.ts /
// dashboard.service.ts, ambos com um `toDateString` idêntico a este).
// Confirmado empiricamente contra o Postgres real deste ambiente durante
// a implementação desta task (backend/test/inspection-pdf.e2e-spec.ts).
export function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

// Desenha marca d'água centralizada + rodapé na página ATUAL do
// `doc`. Usado em dois pontos: (1) na primeira página, antes do
// conteúdo ser escrito, e (2) em todo `pageAdded` subsequente —
// pdfkit não tem "background" nativo, então a forma robusta de
// cobrir todas as páginas é re-aplicar a cada nova. O conteúdo
// escrito DEPOIS desta chamada passa por cima (no caso da marca
// d'água: opacidade 0.18 garante que não esconde texto; no caso
// do rodapé: é desenhado numa faixa que o corpo do relatório
// nunca alcança graças a doc.moveDown() antes de preencher).
function drawPageChrome(doc: PDFKit.PDFDocument): void {
  const { width, height } = doc.page;

  // Marca d'água: centralizada, opaca 18% (RGBA da imagem já
  // contribue com transparência, mas o `opacity` do pdfkit aplica
  // um fator adicional pra ficar realmente discreto).
  const watermarkX = (width - WATERMARK_TARGET_WIDTH) / 2;
  const watermarkY = (height - WATERMARK_TARGET_WIDTH * (275 / 375)) / 2;
  doc.save();
  doc.opacity(0.18);
  doc.image(WATERMARK_PATH, watermarkX, watermarkY, {
    width: WATERMARK_TARGET_WIDTH,
  });
  doc.restore();

  // Rodapé: largura total útil, ancorado no rodapé. A imagem é
  // 2000x420, então a largura segue a altura-alvo pra manter a
  // proporção.
  const footerWidth = FOOTER_TARGET_HEIGHT * (2000 / 420);
  const footerX = (width - footerWidth) / 2;
  const footerY = height - FOOTER_TARGET_HEIGHT - FOOTER_BOTTOM_MARGIN;
  doc.image(FOOTER_PATH, footerX, footerY, {
    height: FOOTER_TARGET_HEIGHT,
  });
}

export function buildInspectionPdf(inspection: InspectionDetail, ctx: InspectionPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margins: { top: 50, left: 50, right: 50, bottom: 80 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Página 1: desenha marca d'água + rodapé ANTES do conteúdo
    // do relatório, assim o texto passa por cima (mantendo
    // legibilidade). Páginas seguintes: re-aplica via `pageAdded`
    // porque pdfkit reseta o "page" a cada addPage().
    drawPageChrome(doc);
    doc.on('pageAdded', () => drawPageChrome(doc));

    doc.fontSize(18).text('RELATÓRIO DE VISITA TÉCNICA', { align: 'center' });
    doc.fontSize(12).text('Segurança do Trabalho', { align: 'center' });
    doc.moveDown();

    doc.fontSize(13).text('1. Identificação');
    doc.fontSize(11);
    doc.text(`Empresa: ${ctx.tenantName}`);
    doc.text(`CNPJ: ${ctx.tenantCnpj}`);
    doc.text(`Endereço: ${ctx.companyUnitAddress ?? 'não informado'}`);
    doc.text(`Data da visita: ${toDateString(inspection.visited_at)}`);
    doc.text(`Horário: ${inspection.started_at ?? '—'} às ${inspection.ended_at ?? '—'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_contact ?? 'não informado'}`);
    doc.moveDown();

    for (const block of ['documentacao', 'epis', 'instalacoes', 'maquinas'] as const) {
      doc.fontSize(13).text(`${BLOCK_LABELS[block]}`);
      doc.fontSize(11);
      const items = inspection.items.filter((i) => i.block === block);
      for (const item of items) {
        const status = item.status ? STATUS_LABELS[item.status] : 'não avaliado';
        doc.text(`- ${item.item_label}: ${status}${item.notes ? ` — ${item.notes}` : ''}`);
      }
      doc.moveDown();
    }

    doc.fontSize(13).text('Conscientização (DDS)');
    doc.fontSize(11);
    doc.text(`Tema abordado: ${inspection.dds_topic ?? 'não informado'}`);
    doc.text(`Participantes: ${inspection.dds_participants_count ?? 'não informado'}`);
    doc.text(`Pontos reforçados: ${inspection.dds_notes ?? 'não informados'}`);
    doc.moveDown();

    doc.fontSize(13).text('Não conformidades identificadas');
    doc.fontSize(11);
    if (inspection.action_plans.length === 0) {
      doc.text('Nenhuma não conformidade identificada nesta visita.');
    } else {
      for (const plan of inspection.action_plans) {
        doc.text(
          `- ${plan.description} | Prazo: ${toDateString(plan.deadline) ?? 'não definido'} | Responsável: ${plan.responsible ?? 'não definido'} | Status: ${plan.status}`,
        );
      }
    }
    doc.moveDown();

    doc.fontSize(13).text('Recomendações gerais');
    doc.fontSize(11).text(inspection.general_recommendations || 'Nenhuma recomendação registrada.');
    doc.moveDown();

    doc.fontSize(13).text('Assinaturas');
    doc.fontSize(11);
    doc.text(`Técnico responsável: ${inspection.technician_signature_name ?? 'não assinado'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_signature_name ?? 'não assinado'}`);

    doc.end();
  });
}

// Modelo em BRANCO do relatório, para o técnico imprimir e preencher na
// visita. Usa a mesma fonte de verdade do relatório real (CHECKLIST_ITEMS,
// BLOCK_LABELS) e a mesma identidade visual, então nunca diverge do que o
// sistema gera ao concluir a inspeção. Não recebe nenhum dado de tenant.
export function buildBlankInspectionPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margins: { top: 50, left: 50, right: 50, bottom: 80 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawPageChrome(doc);
    doc.on('pageAdded', () => drawPageChrome(doc));

    const line = (label: string) => doc.fontSize(11).text(`${label}: ______________________________________________`);

    doc.fontSize(18).text('RELATÓRIO DE VISITA TÉCNICA', { align: 'center' });
    doc.fontSize(12).text('Segurança do Trabalho — modelo para preenchimento', { align: 'center' });
    doc.moveDown();

    doc.fontSize(13).text('1. Identificação');
    line('Empresa');
    line('CNPJ');
    line('Filial / endereço');
    line('Data da visita');
    line('Horário (início / fim)');
    line('Responsável pela empresa');
    doc.moveDown();

    doc.fontSize(10).fillColor('#555555').text('Marque C (conforme), NC (não conforme) ou NA (não se aplica).');
    doc.fillColor('#000000').moveDown(0.5);

    for (const block of ['documentacao', 'epis', 'instalacoes', 'maquinas'] as const) {
      doc.fontSize(13).text(BLOCK_LABELS[block]);
      doc.fontSize(11);
      for (const item of CHECKLIST_ITEMS.filter((i) => i.block === block)) {
        doc.text(`[  ] C   [  ] NC   [  ] NA    ${item.item_label}`);
        doc.text('Observação: ________________________________________________', { indent: 20 });
      }
      doc.moveDown();
    }

    doc.fontSize(13).text('Conscientização (DDS)');
    line('Tema abordado');
    line('Nº de participantes');
    line('Pontos reforçados');
    doc.moveDown();

    doc.fontSize(13).text('Não conformidades identificadas');
    doc.fontSize(11);
    for (let i = 1; i <= 3; i++) {
      doc.text(`${i}. Descrição: ______________________________________________`);
      doc.text('Prazo: ____ / ____ / ______     Responsável: ______________________', { indent: 20 });
    }
    doc.moveDown();

    doc.fontSize(13).text('Recomendações gerais');
    doc.fontSize(11);
    for (let i = 0; i < 3; i++) doc.text('_______________________________________________________________');
    doc.moveDown();

    doc.fontSize(13).text('Assinaturas');
    line('Técnico responsável');
    line('Responsável pela empresa');

    doc.end();
  });
}
