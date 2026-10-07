import { tituloAtencaoAuditoria } from '../src/dashboard/dashboard.service';

// O módulo interno ainda se chama "pente-fino" (rotas, API, tabelas), mas o nome mostrado ao
// usuário é "Auditoria Montese".
describe('título do item de atenção da Auditoria Montese no dashboard', () => {
  it('risco sem exame correspondente', () => {
    expect(tituloAtencaoAuditoria('risco_sem_exame', 'Soldador')).toBe(
      'Auditoria Montese: risco sem exame correspondente — Soldador',
    );
  });

  it('exame sem risco correspondente (qualquer outro status)', () => {
    expect(tituloAtencaoAuditoria('exame_sem_risco', 'Motorista')).toBe(
      'Auditoria Montese: exame sem risco correspondente — Motorista',
    );
  });

  it('não mostra mais o nome antigo ao usuário', () => {
    for (const status of ['risco_sem_exame', 'exame_sem_risco']) {
      expect(tituloAtencaoAuditoria(status, 'Cargo')).not.toMatch(/pente[- ]?fino/i);
    }
  });
});
