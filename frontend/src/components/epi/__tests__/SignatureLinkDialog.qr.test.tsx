import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';

// Integração real (sem mock): a biblioteca instalada gera um PNG em data URL, no próprio ambiente do navegador/Node.
describe('qrcode (biblioteca real)', () => {
  it('toDataURL devolve um PNG em data URL com as opções do diálogo', async () => {
    const url = 'https://app.montese.test/assinar#token=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
    const out = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    expect(out.startsWith('data:image/png;base64,')).toBe(true);
    expect(out.length).toBeGreaterThan(200);
    const png = Buffer.from(out.split(',')[1], 'base64');
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
