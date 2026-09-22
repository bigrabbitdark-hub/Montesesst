import { hashQuestion, tokensAllowedForClaim } from '../src/normative/query-trace';

describe('hashQuestion (unit)', () => {
  it('é um SHA-256 hexadecimal de 64 caracteres', () => {
    expect(hashQuestion('Quem pode trabalhar em altura?')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora maiúsculas e espaços extras: a mesma pergunta dá o mesmo hash', () => {
    expect(hashQuestion('  Quem  pode\ntrabalhar em ALTURA? ')).toBe(hashQuestion('quem pode trabalhar em altura?'));
  });

  it('perguntas diferentes dão hashes diferentes e o hash não contém o texto', () => {
    const a = hashQuestion('pergunta um');
    expect(a).not.toBe(hashQuestion('pergunta dois'));
    expect(a).not.toContain('pergunta');
  });
});

describe('tokensAllowedForClaim (unit)', () => {
  const none = { chunk_ids: [], operational_ref_ids: [], company_chunk_ids: [], checklist_ref_ids: [], uses_attachment: false };

  it('permite quando a claim cita só trechos normativos oficiais', () => {
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1', 'c2'] })).toBe(true);
  });

  it('não permite sem nenhum trecho normativo', () => {
    expect(tokensAllowedForClaim(none)).toBe(false);
  });

  it('não permite se a claim também cita documento da empresa, item operacional, checklist ou anexo', () => {
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], company_chunk_ids: ['d1'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], operational_ref_ids: ['op-0'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], checklist_ref_ids: ['k1'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], uses_attachment: true })).toBe(false);
  });
});
