import { redactCpf, redactKnownNames, redactPii } from '../src/common/text/pii-redaction.util';

// ITEM 003 (auditoria 2026-09-27): garante que a minimização de PII aplicada
// antes de enviar texto de documento/transcrição a provedores externos de
// IA (OpenRouter/MiniMax) realmente remove CPF e nomes cadastrados do
// tenant, sem destruir o restante do texto técnico.

describe('redactCpf', () => {
  it('remove CPF formatado com pontuação', () => {
    expect(redactCpf('Funcionário CPF 123.456.789-01 admitido em 2020.')).toBe(
      'Funcionário CPF [CPF removido] admitido em 2020.',
    );
  });

  it('remove CPF em 11 dígitos sem pontuação', () => {
    expect(redactCpf('CPF: 12345678901 - ativo')).toBe('CPF: [CPF removido] - ativo');
  });

  it('não mexe em números que não têm formato de CPF (ex.: CA de EPI, telefone curto)', () => {
    expect(redactCpf('CA 12345 válido até 2027, ramal 4321')).toBe('CA 12345 válido até 2027, ramal 4321');
  });

  it('não mexe em texto sem nenhum número', () => {
    expect(redactCpf('PGR revisado conforme NR-01.')).toBe('PGR revisado conforme NR-01.');
  });
});

describe('redactKnownNames', () => {
  it('remove nome completo cadastrado, preservando o resto da frase', () => {
    const text = 'Exame admissional de João da Silva Santos realizado em 10/01/2026, apto.';
    expect(redactKnownNames(text, ['João da Silva Santos'])).toBe(
      'Exame admissional de [nome removido] realizado em 10/01/2026, apto.',
    );
  });

  it('é case-insensitive e lida com acentuação', () => {
    const text = 'Colaborador JOSÉ AUGUSTO PEREIRA participou do treinamento de NR-35.';
    expect(redactKnownNames(text, ['José Augusto Pereira'])).toBe(
      'Colaborador [nome removido] participou do treinamento de NR-35.',
    );
  });

  it('não redige nome parcial dentro de outra palavra (falso positivo)', () => {
    const text = 'Empresa Anasilva Comércio de EPIs Ltda forneceu o material.';
    expect(redactKnownNames(text, ['Ana Silva'])).toBe(text);
  });

  it('ignora nomes muito curtos (< 4 caracteres) pra evitar redigir tudo', () => {
    const text = 'Setor de TI reportou 3 não conformidades.';
    expect(redactKnownNames(text, ['TI'])).toBe(text);
  });

  it('redige múltiplas ocorrências do mesmo nome', () => {
    const text = 'Maria Aparecida Souza assinou o documento. Maria Aparecida Souza é a responsável técnica.';
    expect(redactKnownNames(text, ['Maria Aparecida Souza'])).toBe(
      '[nome removido] assinou o documento. [nome removido] é a responsável técnica.',
    );
  });

  it('redige nome quebrado por quebra de linha (como sai da extração de PDF)', () => {
    const text = 'Colaborador Maria Aparecida\nSouza, apto para a função.';
    expect(redactKnownNames(text, ['Maria Aparecida Souza'])).toBe('Colaborador [nome removido], apto para a função.');
  });

  it('redige nome com espaços múltiplos entre as palavras', () => {
    const text = 'Assinado por  João   da Silva  em 10/01.';
    expect(redactKnownNames(text, ['João da Silva'])).toBe('Assinado por  [nome removido]  em 10/01.');
  });

  it('lista vazia de nomes não altera o texto', () => {
    const text = 'PCMSO sem pendências para o setor administrativo.';
    expect(redactKnownNames(text, [])).toBe(text);
  });
});

describe('redactPii', () => {
  it('aplica as duas reduções em conjunto', () => {
    const text = 'Funcionário Carlos Eduardo Lima, CPF 111.222.333-44, afastado por acidente.';
    expect(redactPii(text, ['Carlos Eduardo Lima'])).toBe(
      'Funcionário [nome removido], CPF [CPF removido], afastado por acidente.',
    );
  });

  it('sem nomes conhecidos, ainda assim redige CPF', () => {
    expect(redactPii('CPF 999.888.777-66 sem vínculo encontrado')).toBe('CPF [CPF removido] sem vínculo encontrado');
  });
});
