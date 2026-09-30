import { isEpiQuestion, epiByFunctionForPrompt, EPI_BY_FUNCTION } from '../src/normative/epi-by-function';

// Achado da auditoria do Assistente (2026-09-28, C-3): SYSTEM_PROMPT_WITH_EPI_GUIDE
// nunca tinha um detector real (era código morto, ver comentário em
// epi-by-function.ts) — este arquivo não existia até essa correção.
describe('isEpiQuestion (unit)', () => {
  it('detecta menção a EPI, maiúscula ou minúscula, singular ou plural', () => {
    expect(isEpiQuestion('Que EPI o pedreiro precisa?')).toBe(true);
    expect(isEpiQuestion('que epi para trabalho em altura')).toBe(true);
    expect(isEpiQuestion('Quais EPIs são obrigatórios pro soldador?')).toBe(true);
  });

  it('não dispara em pergunta sem nenhuma menção a EPI', () => {
    expect(isEpiQuestion('O que é PGR?')).toBe(false);
    expect(isEpiQuestion('Preciso de CIPA?')).toBe(false);
  });

  it('não confunde "epi" com palavra que só contém o mesmo prefixo (borda de palavra)', () => {
    expect(isEpiQuestion('O que é epidemiologia ocupacional?')).toBe(false);
    expect(isEpiQuestion('epifania não é norma')).toBe(false);
  });
});

describe('epiByFunctionForPrompt (unit)', () => {
  it('gera uma linha por função, com NRs e lista de EPIs', () => {
    const text = epiByFunctionForPrompt();
    expect(text.split('\n')).toHaveLength(EPI_BY_FUNCTION.length);
    expect(text).toContain('Soldador');
    expect(text).toContain('NR-06');
  });
});
