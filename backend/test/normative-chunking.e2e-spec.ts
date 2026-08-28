import { splitIntoChunks } from '../src/normative/chunking.util';
import { toVectorLiteral } from '../src/normative/vector.util';

function buildIndexedText(charLength: number): string {
  const tokens: string[] = [];
  for (let i = 0; i * 5 < charLength; i++) {
    tokens.push(i.toString().padStart(5, '0'));
  }
  return tokens.join('').slice(0, charLength);
}

describe('splitIntoChunks', () => {
  it('texto vazio retorna lista vazia', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   ')).toEqual([]);
  });

  it('texto menor que o tamanho do pedaço retorna um único pedaço', () => {
    expect(splitIntoChunks('texto curto')).toEqual(['texto curto']);
  });

  it('divide texto longo em pedaços de 2000 caracteres com 200 de sobreposição', () => {
    const text = buildIndexedText(4500);
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2000);
    expect(chunks[1]).toHaveLength(2000);
    expect(chunks[2]).toHaveLength(900);

    expect(chunks[0].slice(1800)).toBe(chunks[1].slice(0, 200));
    expect(chunks[1].slice(1800)).toBe(chunks[2].slice(0, 200));

    expect(chunks[0] + chunks[1].slice(200) + chunks[2].slice(200)).toBe(text);
  });
});

describe('toVectorLiteral', () => {
  it('serializa um array de números pro formato de literal do pgvector', () => {
    expect(toVectorLiteral([1, 0.5, -2])).toBe('[1,0.5,-2]');
  });

  it('array vazio vira literal vazio', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });
});
