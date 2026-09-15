import PDFDocument from 'pdfkit';
import { InspectionDetail } from './inspections.service';

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

export function buildInspectionPdf(inspection: InspectionDetail, ctx: InspectionPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

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
