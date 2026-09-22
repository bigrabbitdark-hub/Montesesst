import { readFileSync } from 'fs';
import { join } from 'path';
import { countByTipo, GoldenQuestion, Tipo, validateGoldenDataset } from '../eval/golden/golden-schema';

// Distribuição definida na spec (docs/specs/assistente-confiabilidade-etapa-2-3.md §3.3).
const EXPECTED_DISTRIBUTION: Record<Tipo, number> = {
  conceitual: 8,
  aplicacao: 8,
  caso_real: 8,
  contexto_incompleto: 8,
  pegadinha: 8,
  jurisdicional: 8,
  atribuicao_profissional: 6,
  sem_evidencia: 6,
};

describe('banco de perguntas golden — backend/eval/golden/perguntas.json (unit)', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../eval/golden/perguntas.json'), 'utf8'));

  it('é válido pelo schema (sem nenhum erro)', () => {
    expect(validateGoldenDataset(raw)).toEqual([]);
  });

  it('tem exatamente a distribuição de 60 perguntas por tipo definida na spec', () => {
    expect(countByTipo(raw as GoldenQuestion[])).toEqual(EXPECTED_DISTRIBUTION);
  });

  it('toda pergunta com fonte esperada foi conferida pelo eval:lint --write (versao_fonte e data_verificacao)', () => {
    const naoConferidas = (raw as GoldenQuestion[])
      .filter((q) => q.fontes_esperadas.length > 0 && (q.versao_fonte === null || q.data_verificacao === null))
      .map((q) => q.id);
    expect(naoConferidas).toEqual([]);
  });

  it('não há duas perguntas com o mesmo texto', () => {
    const textos = (raw as GoldenQuestion[]).map((q) => q.pergunta.trim().toLowerCase());
    expect(new Set(textos).size).toBe(textos.length);
  });
});
