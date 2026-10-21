import { diasEmAtraso, somarMrr, temPendencia } from '../src/atuacao/financeiro-regras';

describe('financeiro-regras', () => {
  describe('temPendencia', () => {
    it('ativa + approved => sem pendência', () => {
      expect(temPendencia('ativa', 'approved')).toBe(false);
    });
    it.each(['rejected', 'pending', 'in_process', 'cancelled', 'refunded'])('ativa + %s => pendência', (s) => {
      expect(temPendencia('ativa', s)).toBe(true);
    });
    it('ativa sem pagamento => sem pendência', () => {
      expect(temPendencia('ativa', null)).toBe(false);
    });
    it.each(['trial', 'pendente', 'inativa'] as const)('%s nunca tem pendência', (sit) => {
      for (const s of ['approved', 'rejected', 'pending', null]) expect(temPendencia(sit, s)).toBe(false);
    });
  });

  describe('diasEmAtraso', () => {
    it('0 no mesmo dia', () => expect(diasEmAtraso('2026-10-20', '2026-10-20')).toBe(0));
    it('N dias de diferença', () => expect(diasEmAtraso('2026-10-17', '2026-10-20')).toBe(3));
    it('atravessa mês e ano', () => {
      expect(diasEmAtraso('2026-09-28', '2026-10-02')).toBe(4);
      expect(diasEmAtraso('2025-12-30', '2026-01-02')).toBe(3);
    });
    it('nunca negativo', () => expect(diasEmAtraso('2026-10-25', '2026-10-20')).toBe(0));
  });

  describe('somarMrr', () => {
    it('soma os preços', () => expect(somarMrr([29900, 49900, 100])).toBe(79900));
    it('vazio => 0', () => expect(somarMrr([])).toBe(0));
  });
});
