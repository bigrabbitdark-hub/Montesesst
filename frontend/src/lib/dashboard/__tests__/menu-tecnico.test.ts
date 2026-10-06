import { describe, it, expect } from 'vitest';
import { itemAtivo } from '../menu';
import { TECNICO_MENU_ITEMS } from '../menu-tecnico';

describe('menu do técnico', () => {
  it('mantém as rotas existentes, na ordem do menu antigo', () => {
    expect(TECNICO_MENU_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Suas empresas', '/tecnico/empresas'],
      ['Agenda', '/tecnico/agendamentos'],
      ['Vencimentos', '/tecnico/agenda'],
      ['Consulta de CA', '/tecnico/consulta-ca'],
      ['Configurações', '/tecnico/configuracoes'],
    ]);
    expect(TECNICO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
  it('não tem hrefs duplicados nem rotas da empresa (o RoleGuard barraria)', () => {
    const hrefs = TECNICO_MENU_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((h) => h.startsWith('/tecnico/'))).toBe(true);
  });
});

describe('itemAtivo com o menu do técnico', () => {
  it('subrota da empresa vinculada mantém "Suas empresas" ativo', () => {
    expect(itemAtivo('/tecnico/empresas/abc/inspecoes/1', TECNICO_MENU_ITEMS)).toBe('/tecnico/empresas');
  });
  it('Agenda e Vencimentos não se confundem (prefixo parecido)', () => {
    expect(itemAtivo('/tecnico/agendamentos', TECNICO_MENU_ITEMS)).toBe('/tecnico/agendamentos');
    expect(itemAtivo('/tecnico/agenda', TECNICO_MENU_ITEMS)).toBe('/tecnico/agenda');
  });
});
