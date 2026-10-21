import { AGENDA_STATUS, AGENDA_TIPOS, exigeNotaAgenda, transicaoAgendaPermitida } from '../src/atuacao/agenda-status';

describe('agenda-status', () => {
  it('só agendado muda, e só para concluido ou cancelado', () => {
    const permitidas: string[] = [];
    for (const de of AGENDA_STATUS) for (const para of AGENDA_STATUS) if (transicaoAgendaPermitida(de, para)) permitidas.push(`${de}>${para}`);
    expect(permitidas.sort()).toEqual(['agendado>cancelado', 'agendado>concluido']);
  });
  it('mesmo estado e saída de terminais são proibidos', () => {
    expect(transicaoAgendaPermitida('agendado', 'agendado')).toBe(false);
    expect(transicaoAgendaPermitida('concluido', 'agendado')).toBe(false);
    expect(transicaoAgendaPermitida('cancelado', 'agendado')).toBe(false);
    expect(transicaoAgendaPermitida('cancelado', 'concluido')).toBe(false);
    expect(transicaoAgendaPermitida('concluido', 'cancelado')).toBe(false);
  });
  it('só cancelado exige nota', () => {
    expect(AGENDA_STATUS.filter((s) => exigeNotaAgenda(s))).toEqual(['cancelado']);
  });
  it('tipos', () => {
    expect([...AGENDA_TIPOS]).toEqual(['reuniao', 'visita', 'ligacao', 'outro']);
  });
});
