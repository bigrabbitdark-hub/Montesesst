import { buildBlankInspectionPdf } from '../src/inspections/inspection-pdf.util';
import { CHECKLIST_ITEMS } from '../src/inspections/checklist-items.const';
import { extractPdfText } from '../src/common/pdf/pdf-text.util';

describe('buildBlankInspectionPdf (unit)', () => {
  it('gera PDF válido com todos os itens do checklist real e os campos de preenchimento', async () => {
    const pdf = await buildBlankInspectionPdf();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = (await extractPdfText(pdf)) ?? '';
    for (const item of CHECKLIST_ITEMS) expect(text).toContain(item.item_label);
    for (const label of ['Identificação', 'Conscientização (DDS)', 'Não conformidades identificadas', 'Assinaturas']) {
      expect(text).toContain(label);
    }
  });
});
