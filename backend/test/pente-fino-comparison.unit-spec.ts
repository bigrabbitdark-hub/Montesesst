import { buildFunctionReport, StoredRow } from '../src/pente-fino/pente-fino-comparison.service';

describe('buildFunctionReport', () => {
  const positions = [{ id: 'pos-1', name: 'Soldador' }];

  function risk(overrides: Partial<StoredRow> = {}): StoredRow {
    return { position_id: 'pos-1', function_text_raw: 'Soldador', description: 'Fumos metálicos', source_excerpt: 'trecho', ...overrides };
  }
  function exam(overrides: Partial<StoredRow> = {}): StoredRow {
    return { position_id: 'pos-1', function_text_raw: 'Soldador', description: 'Exame respiratório', source_excerpt: 'trecho', ...overrides };
  }

  it('função com risco e exame casados por position_id vira status ok', () => {
    const report = buildFunctionReport([risk()], [exam()], positions);
    expect(report).toEqual([
      expect.objectContaining({ position_id: 'pos-1', position_name: 'Soldador', status: 'ok' }),
    ]);
  });

  it('função só com risco vira risco_sem_exame', () => {
    const report = buildFunctionReport([risk()], [], positions);
    expect(report[0].status).toBe('risco_sem_exame');
  });

  it('função só com exame vira exame_sem_risco', () => {
    const report = buildFunctionReport([], [exam()], positions);
    expect(report[0].status).toBe('exame_sem_risco');
  });

  it('função sem position_id (não bateu com cargo cadastrado) vira nome_sem_correspondencia, mesmo com risco e exame', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'Ajudante' })],
      [exam({ position_id: null, function_text_raw: 'Ajudante' })],
      [],
    );
    expect(report[0].status).toBe('nome_sem_correspondencia');
  });

  it('duas funções sem position_id mas com texto normalizado diferente viram grupos separados', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'Ajudante Geral' })],
      [exam({ position_id: null, function_text_raw: 'Auxiliar de Limpeza' })],
      [],
    );
    expect(report).toHaveLength(2);
  });

  it('duas funções sem position_id mas com texto normalizado IGUAL viram um grupo só', () => {
    const report = buildFunctionReport(
      [risk({ position_id: null, function_text_raw: 'AJUDANTE GERAL' })],
      [exam({ position_id: null, function_text_raw: 'ajudante geral' })],
      [],
    );
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('nome_sem_correspondencia');
  });
});
