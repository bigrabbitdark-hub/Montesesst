import { splitIntoChunks, groupLinesIntoChunks } from '../src/common/chunking/chunking.util';
import { toVectorLiteral } from '../src/common/vector/vector.util';

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

describe('groupLinesIntoChunks', () => {
  it('lista vazia retorna lista vazia', () => {
    expect(groupLinesIntoChunks([])).toEqual([]);
  });

  it('linhas cujo total cabe num único pedaço voltam como um único pedaço, unidas por \\n', () => {
    expect(groupLinesIntoChunks(['linha um', 'linha dois'])).toEqual(['linha um\nlinha dois']);
  });

  it('ignora linhas vazias/só espaço', () => {
    expect(groupLinesIntoChunks(['linha um', '   ', '', 'linha dois'])).toEqual(['linha um\nlinha dois']);
  });

  it('quando o total excede o tamanho do pedaço, agrupa em vários pedaços SEM nunca cortar uma linha ao meio', () => {
    // Cada linha tem 300 caracteres — bem menor que CHUNK_CHAR_SIZE
    // (2000), mas 10 delas juntas (3000 + separadores) excedem o limite,
    // forçando a função a fechar o pedaço atual e abrir outro.
    const lines = Array.from({ length: 10 }, (_, i) => `linha-${i}-`.repeat(30));
    const chunks = groupLinesIntoChunks(lines);

    expect(chunks.length).toBeGreaterThan(1);
    // Cada pedaço, invertido, precisa reconstruir um subconjunto de
    // linhas ORIGINAIS e COMPLETAS — nenhuma linha aparece cortada, e a
    // concatenação de todos os pedaços contém cada linha original
    // exatamente uma vez, na ordem.
    const reconstructedLines = chunks.flatMap((chunk) => chunk.split('\n'));
    expect(reconstructedLines).toEqual(lines);
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        expect(lines).toContain(line);
      }
    }
  });

  it('uma única linha maior que o tamanho do pedaço vira um pedaço sozinha, inteira, acima do limite de caracteres', () => {
    const hugeLine = 'X'.repeat(2500);
    const chunks = groupLinesIntoChunks(['linha curta', hugeLine, 'outra linha curta']);

    expect(chunks.some((c) => c === hugeLine)).toBe(true);
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
