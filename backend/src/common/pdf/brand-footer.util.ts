import { join } from 'path';

// Ativo fornecido pelo proprietário (3200x672). Copiado para dist/src pelo nest-cli.json (assets).
const FOOTER_IMAGE = join(__dirname, 'assets', 'montese-footer.png');
const FOOTER_RATIO = 672 / 3200; // altura/largura da imagem
const TECH_LINE_HEIGHT = 18;

// Altura total reservada no pé da página: faixa de marca (largura total) + linha técnica.
export function brandFooterHeight(pageWidth: number): number {
  return pageWidth * FOOTER_RATIO + TECH_LINE_HEIGHT;
}

// Desenha, na página atual, a linha técnica e a faixa de marca em largura total. Zera a margem
// inferior só durante o desenho (senão o pdfkit abre uma página nova ao escrever na margem).
export function drawBrandFooter(doc: PDFKit.PDFDocument, opts: { technicalLine: string }): void {
  const { width, height } = doc.page;
  const bannerH = width * FOOTER_RATIO;
  const saved = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.image(FOOTER_IMAGE, 0, height - bannerH, { width });
  doc.font('Helvetica').fontSize(7).fillColor('#444444')
    .text(opts.technicalLine, 40, height - bannerH - TECH_LINE_HEIGHT + 5, { width: width - 80, align: 'center', lineBreak: false });
  doc.page.margins.bottom = saved;
  doc.fillColor('#000000');
}
