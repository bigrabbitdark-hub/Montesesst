import { faixaAtingida, prioridadeDoPrazo } from '../src/atuacao/alertas/alertas-job.service';

describe('alertas: faixa atingida e prioridade (funções puras)', () => {
  const N = [60, 30, 15, 7, 0];
  it('escolhe a MENOR antecedência já atingida', () => {
    expect(faixaAtingida(61, N)).toBeNull();
    expect(faixaAtingida(60, N)).toBe(60);
    expect(faixaAtingida(45, N)).toBe(60);
    expect(faixaAtingida(30, N)).toBe(30);
    expect(faixaAtingida(20, N)).toBe(30);
    expect(faixaAtingida(8, N)).toBe(15);
    expect(faixaAtingida(7, N)).toBe(7);
    expect(faixaAtingida(1, N)).toBe(7);
    expect(faixaAtingida(0, N)).toBe(0);
  });
  it('funciona com antecedências personalizadas e fora de ordem', () => {
    expect(faixaAtingida(9, [0, 10])).toBe(10);
    expect(faixaAtingida(11, [0, 10])).toBeNull();
    expect(faixaAtingida(0, [10, 0])).toBe(0);
    expect(faixaAtingida(5, [90])).toBe(90);
  });
  it('prioridade: até 7 dias alta, até 30 média, acima baixa', () => {
    expect(prioridadeDoPrazo(0)).toBe('alta');
    expect(prioridadeDoPrazo(7)).toBe('alta');
    expect(prioridadeDoPrazo(8)).toBe('media');
    expect(prioridadeDoPrazo(30)).toBe('media');
    expect(prioridadeDoPrazo(31)).toBe('baixa');
  });
});
