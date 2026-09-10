import { Document, Packer, Paragraph } from 'docx';
import { extractDocxText } from '../src/common/docx/docx-text.util';

async function buildTestDocx(text: string): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return Packer.toBuffer(doc);
}

describe('extractDocxText', () => {
  it('extrai o texto real de um .docx válido', async () => {
    const docx = await buildTestDocx('Conteúdo real de teste no DOCX.');
    const result = await extractDocxText(docx);
    expect(result).toContain('Conteúdo real de teste no DOCX.');
  });

  it('devolve null pra buffer que não é um .docx válido', async () => {
    const result = await extractDocxText(Buffer.from('isto não é um docx'));
    expect(result).toBeNull();
  });
});
