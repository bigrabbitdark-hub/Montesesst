import PDFDocument from 'pdfkit';
import { CipaMeeting } from './committees.service';
import { CipaMeetingParticipant } from './meetings.service';

// pdfkit escreve em um stream — coletamos os chunks num Buffer só,
// mesmo padrão de qualquer geração de PDF em memória com essa lib
// (sem escrever em disco, o resultado vai direto pro R2 via
// DocumentsService.upload).
export function buildAtaPdf(
  meeting: CipaMeeting,
  tenantName: string,
  participants: CipaMeetingParticipant[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const titulo =
      meeting.tipo === 'ordinaria'
        ? `${meeting.numero}ª Reunião Ordinária da CIPA`
        : meeting.titulo || 'Reunião Extraordinária da CIPA';

    doc.fontSize(18).text('ATA DA REUNIÃO DA CIPA', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(titulo);
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Empresa: ${tenantName}`);
    doc.text(`Data: ${meeting.data ?? 'não informada'}`);
    doc.text(`Hora: ${meeting.hora ?? 'não informada'}`);
    doc.text(`Local: ${meeting.local ?? 'não informado'}`);
    doc.moveDown();

    doc.fontSize(13).text('Participantes');
    doc.fontSize(11);
    if (participants.length === 0) {
      doc.text('Nenhum participante registrado.');
    } else {
      for (const p of participants) {
        doc.text(`- ${p.nome_livre ?? '(membro da CIPA)'} — ${p.presente ? 'presente' : 'ausente'}`);
      }
    }
    doc.moveDown();

    doc.fontSize(13).text('Pauta');
    doc.fontSize(11).text(meeting.pauta || 'Não informada');
    doc.moveDown();

    doc.fontSize(13).text('Discussões');
    doc.fontSize(11).text(meeting.discussoes || 'Não informadas');
    doc.moveDown();

    doc.fontSize(13).text('Deliberações');
    doc.fontSize(11).text(meeting.deliberacoes || 'Não informadas');
    doc.moveDown();

    if (meeting.proxima_reuniao_data) {
      doc.fontSize(13).text('Próxima reunião');
      doc.fontSize(11).text(meeting.proxima_reuniao_data);
    }

    doc.end();
  });
}
