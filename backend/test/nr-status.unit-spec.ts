import { avaliarEvidencia, hojeISO, somarDias } from '../src/nr-conformidade/nr-status';

const HOJE = '2026-10-01';

describe('somarDias / hojeISO', () => {
  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-10-01', 30)).toBe('2026-10-31');
    expect(somarDias('2026-12-15', 30)).toBe('2027-01-14');
  });
  it('hojeISO usa a data local no formato yyyy-mm-dd', () => {
    expect(hojeISO(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
});

describe('avaliarEvidencia — agregação "alguma"', () => {
  it('sem evidência: pendente, quantidade 0', () => {
    expect(avaliarEvidencia({ validades: [] }, 'alguma', HOJE)).toEqual({
      status: 'pendente', quantidade: 0, proxima_validade: null,
    });
  });
  it('todas vencidas: pendente', () => {
    const r = avaliarEvidencia({ validades: ['2026-09-30', '2026-01-01'] }, 'alguma', HOJE);
    expect(r.status).toBe('pendente');
    expect(r.quantidade).toBe(2);
    expect(r.proxima_validade).toBeNull();
  });
  it('uma vigente (>30 dias) basta, mesmo com outra vencida: em_dia', () => {
    const r = avaliarEvidencia({ validades: ['2026-01-01', '2027-03-01'] }, 'alguma', HOJE);
    expect(r.status).toBe('em_dia');
    expect(r.proxima_validade).toBe('2027-03-01');
  });
  it('só vencendo (<=30 dias): atencao', () => {
    const r = avaliarEvidencia({ validades: ['2026-10-20'] }, 'alguma', HOJE);
    expect(r.status).toBe('atencao');
    expect(r.proxima_validade).toBe('2026-10-20');
  });
  it('vence hoje conta como vencendo, não vencido', () => {
    expect(avaliarEvidencia({ validades: [HOJE] }, 'alguma', HOJE).status).toBe('atencao');
  });
  it('exatamente 30 dias ainda é vencendo; 31 dias é vigente', () => {
    expect(avaliarEvidencia({ validades: ['2026-10-31'] }, 'alguma', HOJE).status).toBe('atencao');
    expect(avaliarEvidencia({ validades: ['2026-11-01'] }, 'alguma', HOJE).status).toBe('em_dia');
  });
  it('evidência sem validade conta como vigente', () => {
    const r = avaliarEvidencia({ validades: [null] }, 'alguma', HOJE);
    expect(r).toEqual({ status: 'em_dia', quantidade: 1, proxima_validade: null });
  });
});

describe('avaliarEvidencia — agregação "todas"', () => {
  it('sem evidência: pendente', () => {
    expect(avaliarEvidencia({ validades: [] }, 'todas', HOJE).status).toBe('pendente');
  });
  it('qualquer vencida torna pendente, mesmo havendo vigentes', () => {
    expect(avaliarEvidencia({ validades: ['2027-05-01', '2026-09-01'] }, 'todas', HOJE).status).toBe('pendente');
  });
  it('sem vencidas e alguma vencendo: atencao', () => {
    expect(avaliarEvidencia({ validades: ['2027-05-01', '2026-10-10'] }, 'todas', HOJE).status).toBe('atencao');
  });
  it('todas vigentes ou sem validade: em_dia, proxima = menor data futura', () => {
    const r = avaliarEvidencia({ validades: ['2027-05-01', null, '2026-12-01'] }, 'todas', HOJE);
    expect(r.status).toBe('em_dia');
    expect(r.proxima_validade).toBe('2026-12-01');
    expect(r.quantidade).toBe(3);
  });
});
