import { mergeValidityPatch, resolveValidity } from '../src/documents/document-validity';

describe('resolveValidity', () => {
  describe('regra com meses (pcmso 12, pgr 24, etc)', () => {
    it('pcmso 12: valid_from sozinho → expires_at = +12 meses, source=rule, meses=12', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: null, ruleMonths: 12 });
      expect(r).toEqual({
        validFrom: '2026-01-15',
        expiresAt: '2027-01-15',
        expiresSource: 'rule',
        validityMonthsApplied: 12,
      });
    });

    it('pgr 24: valid_from sozinho → expires_at = +24 meses, source=rule, meses=24', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: null, ruleMonths: 24 });
      expect(r).toEqual({
        validFrom: '2026-01-15',
        expiresAt: '2028-01-15',
        expiresSource: 'rule',
        validityMonthsApplied: 24,
      });
    });

    it('regra diferente do padrão (6 meses)', () => {
      const r = resolveValidity({ validFrom: '2026-06-10', expiresAt: null, ruleMonths: 6 });
      expect(r.expiresAt).toBe('2026-12-10');
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(6);
    });

    it('regra diferente do padrão (36 meses)', () => {
      const r = resolveValidity({ validFrom: '2025-01-01', expiresAt: null, ruleMonths: 36 });
      expect(r.expiresAt).toBe('2028-01-01');
      expect(r.validityMonthsApplied).toBe(36);
    });

    it('29/02 + 12 meses → 28/02 do ano seguinte (clampagem de fim de mês)', () => {
      const r = resolveValidity({ validFrom: '2024-02-29', expiresAt: null, ruleMonths: 12 });
      expect(r.expiresAt).toBe('2025-02-28');
    });

    it('31/01 + 1 mês → 28/02', () => {
      const r = resolveValidity({ validFrom: '2026-01-31', expiresAt: null, ruleMonths: 1 });
      expect(r.expiresAt).toBe('2026-02-28');
    });
  });

  describe('regra NULL (sem vencimento automático)', () => {
    it('valid_from sozinho, sem regra → sem vencimento, source null', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: null, ruleMonths: null });
      expect(r).toEqual({
        validFrom: '2026-01-15',
        expiresAt: null,
        expiresSource: null,
        validityMonthsApplied: null,
      });
    });

    it('regra undefined (categoria sem linha na tabela) também é tratada como sem regra', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: null });
      expect(r.expiresAt).toBeNull();
      expect(r.expiresSource).toBeNull();
    });
  });

  describe('expires_at manual', () => {
    it('só expires_at (sem valid_from) → manual, meses null', () => {
      const r = resolveValidity({ validFrom: null, expiresAt: '2027-06-30', ruleMonths: 12 });
      expect(r).toEqual({
        validFrom: null,
        expiresAt: '2027-06-30',
        expiresSource: 'manual',
        validityMonthsApplied: null,
      });
    });

    it('valid_from + expires_at manual (≠ calculado pela regra) → manual, meses null', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: '2027-08-20', ruleMonths: 12 });
      // 2026-01-15 + 12m = 2027-01-15, mas cliente mandou 2027-08-20 → manual
      expect(r.expiresSource).toBe('manual');
      expect(r.validityMonthsApplied).toBeNull();
      expect(r.expiresAt).toBe('2027-08-20');
      expect(r.validFrom).toBe('2026-01-15');
    });

    it('valid_from + expires_at exatamente igual ao cálculo → rule + meses', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: '2027-01-15', ruleMonths: 12 });
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(12);
    });

    it('valid_from + expires_at, regra NULL → manual', () => {
      const r = resolveValidity({ validFrom: '2026-01-15', expiresAt: '2027-01-15', ruleMonths: null });
      expect(r.expiresSource).toBe('manual');
      expect(r.validityMonthsApplied).toBeNull();
    });
  });

  describe('validação de entrada', () => {
    it('valid_from inválido (ISO com hora) → erro', () => {
      expect(() => resolveValidity({ validFrom: '2026-01-15T00:00:00Z' })).toThrow(/valid_from/);
    });

    it('valid_from inválido (formato BR) → erro', () => {
      expect(() => resolveValidity({ validFrom: '15/01/2026' })).toThrow(/valid_from/);
    });

    it('valid_from inexistente no calendário → erro', () => {
      expect(() => resolveValidity({ validFrom: '2026-02-30' })).toThrow(/valid_from/);
    });

    it('expires_at inválido → erro', () => {
      expect(() => resolveValidity({ expiresAt: 'ontem' })).toThrow(/expires_at/);
    });

    it('expires_at < valid_from → erro', () => {
      expect(() =>
        resolveValidity({ validFrom: '2026-06-01', expiresAt: '2026-05-01', ruleMonths: 12 }),
      ).toThrow(/anterior/);
    });

    it('valid_from com ano fora de 1900..2200 → erro (B1)', () => {
      expect(() => resolveValidity({ validFrom: '9950-01-01' })).toThrow(/data fora do intervalo aceito/);
    });

    it('expires_at com ano fora de 1900..2200 → erro (B1)', () => {
      expect(() => resolveValidity({ expiresAt: '1850-06-01' })).toThrow(/data fora do intervalo aceito/);
    });

    it('valid_from que produziria expires_at calculado fora do intervalo → erro (B1)', () => {
      // valid_from no extremo superior + meses suficientes para estourar 2200.
      // addMonthsChecked deve rejeitar antes de qualquer INSERT.
      expect(() =>
        resolveValidity({ validFrom: '2151-01-01', ruleMonths: 600 }),
      ).toThrow(/data calculada fora do intervalo aceito/);
    });
  });

  describe('nada informado', () => {
    it('sem nenhum campo → tudo null', () => {
      expect(resolveValidity({})).toEqual({
        validFrom: null,
        expiresAt: null,
        expiresSource: null,
        validityMonthsApplied: null,
      });
    });

    it('nulls explícitos → tudo null', () => {
      expect(resolveValidity({ validFrom: null, expiresAt: null, ruleMonths: null })).toEqual({
        validFrom: null,
        expiresAt: null,
        expiresSource: null,
        validityMonthsApplied: null,
      });
    });
  });
});

// Mesclagem usada pelo PATCH /documents/:id/validity. Semântica:
//   - AUSENTE (undefined) = manter; null explícito = limpar; valor = usar.
//   - expires_at AUSENTE: recalcula pela regra SOMENTE se valid_from mudou
//     nesta chamada; senão mantém. Regra sem meses + valid_from novo →
//     preserva (nunca zera um vencimento só porque a categoria não tem
//     regra).
//   - valida expires_at >= valid_from no estado final.
describe('mergeValidityPatch', () => {
  const pcmso = {
    currentValidFrom: '2026-01-15',
    currentExpiresAt: '2027-01-15',
    currentExpiresSource: 'rule' as const,
    currentValidityMonthsApplied: 12,
    ruleMonths: 12,
  };
  const semRegra = {
    currentValidFrom: '2026-01-15',
    currentExpiresAt: null,
    currentExpiresSource: null,
    currentValidityMonthsApplied: null,
    ruleMonths: null,
  };

  describe('valid_from', () => {
    it('AUSENTE → mantém o valid_from atual', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: undefined, ...pcmso });
      expect(r.validFrom).toBe('2026-01-15');
    });

    it('null explícito → limpa o valid_from', () => {
      const r = mergeValidityPatch({ validFrom: null, expiresAt: undefined, ...pcmso });
      expect(r.validFrom).toBeNull();
    });

    it('valor novo → usa o valor', () => {
      const r = mergeValidityPatch({ validFrom: '2026-06-20', expiresAt: undefined, ...pcmso });
      expect(r.validFrom).toBe('2026-06-20');
    });
  });

  describe('expires_at', () => {
    it('AUSENTE e valid_from AUSENTE → mantém expires_at e source atuais', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: undefined, ...pcmso });
      expect(r.expiresAt).toBe('2027-01-15');
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(12);
    });

    it('AUSENTE com valid_from novo em categoria COM regra → recalcula', () => {
      const r = mergeValidityPatch({ validFrom: '2026-06-01', expiresAt: undefined, ...pcmso });
      expect(r.expiresAt).toBe('2027-06-01');
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(12);
    });

    it('AUSENTE com valid_from novo em categoria SEM regra → PRESERVA expires_at (nunca zera)', () => {
      // Cenário crítico do briefing: documento em categoria sem regra já
      // tem vencimento manual; cliente envia só novo valid_from; o
      // expires_at atual NÃO pode virar null.
      const r = mergeValidityPatch({
        validFrom: '2026-06-01',
        expiresAt: undefined,
        currentValidFrom: '2026-01-15',
        currentExpiresAt: '2026-12-31',
        currentExpiresSource: 'manual',
        currentValidityMonthsApplied: null,
        ruleMonths: null,
      });
      expect(r.validFrom).toBe('2026-06-01');
      expect(r.expiresAt).toBe('2026-12-31');
      expect(r.expiresSource).toBe('manual');
      expect(r.validityMonthsApplied).toBeNull();
    });

    it('null explícito → limpa expires_at, source e meses', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: null, ...pcmso });
      expect(r.expiresAt).toBeNull();
      expect(r.expiresSource).toBeNull();
      expect(r.validityMonthsApplied).toBeNull();
      // valid_from não foi tocado → preservado
      expect(r.validFrom).toBe('2026-01-15');
    });

    it('só expires_at (sem valid_from) → manual, meses null, valid_from preservado', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: '2027-08-20', ...pcmso });
      expect(r.validFrom).toBe('2026-01-15');
      expect(r.expiresAt).toBe('2027-08-20');
      expect(r.expiresSource).toBe('manual');
      expect(r.validityMonthsApplied).toBeNull();
    });

    it('expires_at explícito + valid_from novo que bate na regra → rule + meses', () => {
      const r = mergeValidityPatch({ validFrom: '2026-01-15', expiresAt: '2027-01-15', ...pcmso });
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(12);
    });

    it('expires_at explícito + valid_from novo que NÃO bate na regra → manual, meses null', () => {
      const r = mergeValidityPatch({ validFrom: '2026-01-15', expiresAt: '2027-08-20', ...pcmso });
      expect(r.expiresSource).toBe('manual');
      expect(r.validityMonthsApplied).toBeNull();
      expect(r.expiresAt).toBe('2027-08-20');
    });

    it('expires_at explícito sem valid_from novo que bate na regra → rule (valida contra valid_from atual)', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: '2027-01-15', ...pcmso });
      expect(r.expiresSource).toBe('rule');
      expect(r.validityMonthsApplied).toBe(12);
      expect(r.validFrom).toBe('2026-01-15');
    });
  });

  describe('validação do estado final', () => {
    it('valid_from novo em categoria SEM regra preservando expires_at incompatível → erro', () => {
      // Caso do briefing: "preserve, mas valida no final". Aqui o cliente
      // mudou valid_from pra uma data posterior ao expires_at atual, e a
      // categoria não tem regra pra recalcular; preservamos expires_at mas
      // a coerência de ordem (expires_at >= valid_from) falha → 400.
      expect(() =>
        mergeValidityPatch({
          validFrom: '2027-01-01',
          expiresAt: undefined,
          currentValidFrom: '2026-01-15',
          currentExpiresAt: '2026-06-01',
          currentExpiresSource: 'manual',
          currentValidityMonthsApplied: null,
          ruleMonths: null,
        }),
      ).toThrow(/anterior/);
    });

    it('expires_at < valid_from explícito → erro', () => {
      expect(() =>
        mergeValidityPatch({ validFrom: '2026-06-01', expiresAt: '2026-05-01', ...pcmso }),
      ).toThrow(/anterior/);
    });

    it('valid_from com formato inválido → erro', () => {
      expect(() =>
        mergeValidityPatch({ validFrom: '15/01/2026', expiresAt: undefined, ...pcmso }),
      ).toThrow(/valid_from/);
    });

    it('expires_at com formato inválido → erro', () => {
      expect(() =>
        mergeValidityPatch({ validFrom: undefined, expiresAt: 'ontem', ...pcmso }),
      ).toThrow(/expires_at/);
    });

    it('valid_from com ano fora de 1900..2200 → erro (B1)', () => {
      expect(() =>
        mergeValidityPatch({ validFrom: '9950-01-01', expiresAt: undefined, ...pcmso }),
      ).toThrow(/data fora do intervalo aceito/);
    });

    it('expires_at com ano fora de 1900..2200 → erro (B1)', () => {
      expect(() =>
        mergeValidityPatch({ validFrom: undefined, expiresAt: '2201-06-01', ...pcmso }),
      ).toThrow(/data fora do intervalo aceito/);
    });
  });

  describe('body vazio (sem alteração real)', () => {
    it('AUSENTE/AUSENTE preserva tudo exatamente como está', () => {
      const r = mergeValidityPatch({ validFrom: undefined, expiresAt: undefined, ...semRegra });
      expect(r).toEqual({
        validFrom: '2026-01-15',
        expiresAt: null,
        expiresSource: null,
        validityMonthsApplied: null,
      });
    });
  });
});