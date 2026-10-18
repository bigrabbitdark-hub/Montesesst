import PDFDocument from 'pdfkit';

export async function buildSstAuditPdf(report: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Relatório de Auditoria Cruzada SST', { align: 'left' });
    doc.moveDown();
    doc.fontSize(12).text(`Empresa: ${report.company?.name ?? 'Empresa'}`);
    doc.text(`Status: ${report.audit_status}`);
    doc.text(`Conclusão: ${report.summary?.conclusion ?? 'Sem conclusão disponível'}`);
    doc.moveDown();

    doc.fontSize(14).text('Achados');
    for (const finding of report.findings ?? []) {
      doc.fontSize(11).text(`- ${finding.summary}`);
    }
    doc.moveDown();

    doc.fontSize(14).text('Recomendações');
    for (const recommendation of report.recommendations ?? []) {
      doc.fontSize(11).text(`- ${recommendation}`);
    }
    doc.moveDown();

    doc.fontSize(12).text('Limites e ressalvas');
    for (const limitation of report.limitations ?? []) {
      doc.fontSize(10).text(`• ${limitation}`);
    }

    doc.end();
  });
}
