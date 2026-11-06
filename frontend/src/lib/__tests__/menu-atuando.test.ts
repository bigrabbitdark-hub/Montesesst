import { describe, it, expect } from 'vitest';
import { MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO, filtrarMenuAtuando, rotaBloqueadaAtuando } from '../dashboard/menu';

// Lista final (Step 1, cruzada com o relatório da Task 8 e a spec §3), com a chamada de API que a justifica:
//  /empresa/assistente  -> IA (AssistantChat: /api/assistant)
//  /empresa/agendamentos -> app/empresa/agendamentos/page.tsx:60,62,96 (/api/tenant-technicians/minha-empresa, /api/visits)
//  /empresa/pente-fino  -> POST /api/pente-fino/run (até 7 chamadas de LLM)
//  /empresa/onboarding  -> app/empresa/onboarding/MatrizForm.tsx:89,129,150 (PATCH /api/tenants/me e logo)
describe('filtrarMenuAtuando', () => {
  it('remove os itens bloqueados e mantém o resto', () => {
    const out = filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO);
    const hrefs = out.flatMap((s) => s.itens.map((i) => i.href));
    for (const h of HREFS_BLOQUEADOS_ATUANDO) expect(hrefs).not.toContain(h);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).toContain('/dashboard-v2');
    expect(hrefs).toContain('/empresa/funcionarios');
  });
  it('não deixa setor vazio', () => {
    const out = filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO);
    expect(out.every((s) => s.itens.length > 0)).toBe(true);
    expect(out.map((s) => s.titulo)).not.toContain('Agenda');
  });
  it('lista exata de bloqueados (IA, agendamentos, pente-fino, dados da empresa)', () => {
    expect([...HREFS_BLOQUEADOS_ATUANDO].sort()).toEqual(
      ['/empresa/agendamentos', '/empresa/assistente', '/empresa/onboarding', '/empresa/pente-fino'],
    );
  });
  it('não altera MENU_SETORES (puro)', () => {
    const antes = MENU_SETORES.flatMap((s) => s.itens).length;
    filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO);
    expect(MENU_SETORES.flatMap((s) => s.itens).length).toBe(antes);
  });
});

describe('rotaBloqueadaAtuando', () => {
  it.each(['/empresa/assistente', '/empresa/agendamentos', '/empresa/pente-fino', '/empresa/onboarding', '/empresa/esocial', '/empresa/esocial/cat', '/empresa/pente-fino/x'])(
    'bloqueia %s', (p) => expect(rotaBloqueadaAtuando(p)).toBe(true));
  it.each(['/dashboard-v2', '/empresa/funcionarios', '/empresa/cipa', '/empresa/documentos', '/empresa/assistentes-x', '/empresa/onboarding-x'])(
    'libera %s', (p) => expect(rotaBloqueadaAtuando(p)).toBe(false));
});
