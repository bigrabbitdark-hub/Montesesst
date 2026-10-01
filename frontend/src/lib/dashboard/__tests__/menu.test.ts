import { describe, it, expect } from 'vitest';
import { EXTRA_MENU_ITEMS, MENU_ITEMS } from '../menu';

describe('menu do dashboard', () => {
  it('"Relatório de visita técnica" fica logo depois de Documentos, no grupo principal', () => {
    const labels = MENU_ITEMS.map((i) => i.label);
    const iDocs = labels.indexOf('Documentos');
    expect(iDocs).toBeGreaterThanOrEqual(0);
    expect(labels[iDocs + 1]).toBe('Relatório de visita técnica');
  });
  it('mantém a rota existente (links antigos continuam válidos) e está implementado', () => {
    const item = MENU_ITEMS.find((i) => i.label === 'Relatório de visita técnica');
    expect(item?.href).toBe('/empresa/inspecoes');
    expect(item?.implemented).toBe(true);
  });
  it('não sobra o item antigo "Inspeções" nem duplicata da mesma rota', () => {
    expect(EXTRA_MENU_ITEMS.some((i) => i.label === 'Inspeções')).toBe(false);
    const hrefs = [...MENU_ITEMS, ...EXTRA_MENU_ITEMS].map((i) => i.href);
    expect(hrefs.filter((h) => h === '/empresa/inspecoes')).toHaveLength(1);
  });
});
