import { Logger } from '@nestjs/common';
import { NrConformidadeService } from '../src/nr-conformidade/nr-conformidade.service';

// Falha parcial: a regra da CIPA (NR-5) rejeita; NR-1 e NR-7 precisam continuar sendo avaliadas.
describe('NrConformidadeService — falha parcial por NR (SAVEPOINT)', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => errorSpy.mockRestore());

  it('NR-5 vira nao_avaliavel e NR-1/NR-7 continuam avaliadas depois da falha', async () => {
    const sqls: string[] = [];
    const query = jest.fn(async (sql: string) => {
      sqls.push(sql.trim());
      if (sql.includes('company_applicable_nrs')) {
        return { rows: [{ nr_code: 'NR-1' }, { nr_code: 'NR-5' }, { nr_code: 'NR-7' }] };
      }
      if (sql.includes('cipa_committees')) throw new Error('falha simulada na regra da CIPA');
      if (sql.includes('FROM documents')) return { rows: [{ d: '2027-01-01' }] };
      return { rows: [] };
    });
    const service = new NrConformidadeService();

    const { nrs } = await service.getConformidade({ query } as any, 'tenant-x', '2026-10-01');

    expect(nrs.map((n) => n.code)).toEqual(['NR-1', 'NR-5', 'NR-7']);
    const nr5 = nrs.find((n) => n.code === 'NR-5')!;
    expect(nr5.status).toBe('nao_avaliavel');
    expect(nr5.evidencia).toBeNull();
    expect(nr5.mensagem).toBeTruthy();
    for (const code of ['NR-1', 'NR-7']) {
      expect(nrs.find((n) => n.code === code)!.status).not.toBe('nao_avaliavel');
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const ctrl = sqls.filter((q) => /SAVEPOINT/.test(q));
    expect(ctrl).toEqual([
      'SAVEPOINT nr_eval',
      'RELEASE SAVEPOINT nr_eval', // NR-1
      'SAVEPOINT nr_eval',
      'ROLLBACK TO SAVEPOINT nr_eval', // NR-5 (falhou)
      'SAVEPOINT nr_eval',
      'RELEASE SAVEPOINT nr_eval', // NR-7 (depois da falha)
    ]);
  });
});
