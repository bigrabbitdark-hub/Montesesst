import { transicaoPermitida, exigeNota, TAREFA_STATUS } from '../src/atuacao/tarefa-status';

describe('tarefa-status', () => {
  it.each([
    ['pending', 'in_progress', true], ['pending', 'completed', false],
    ['in_progress', 'awaiting_review', true], ['in_progress', 'completed', true],
    ['blocked', 'completed', false], ['blocked', 'in_progress', true],
    ['awaiting_review', 'completed', true], ['completed', 'in_progress', true],
    ['completed', 'cancelled', false], ['cancelled', 'pending', true], ['cancelled', 'completed', false],
  ])('%s -> %s = %s', (de, para, esperado) => {
    expect(transicaoPermitida(de as any, para as any)).toBe(esperado);
  });
  it('nunca permite transição para o mesmo estado', () => {
    for (const s of TAREFA_STATUS) expect(transicaoPermitida(s, s)).toBe(false);
  });
  it('exige nota ao bloquear e ao cancelar, e só nesses', () => {
    expect(TAREFA_STATUS.filter((s) => exigeNota(s))).toEqual(['blocked', 'cancelled']);
  });
});
