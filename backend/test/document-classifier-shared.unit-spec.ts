import {
  buildClassifyChatCompletionBody,
  parseClassifyToolCall,
  TOOL_SCHEMA,
  VALID_CATEGORIES,
} from '../src/documents/document-classifier-shared';

describe('document-classifier-shared', () => {
  describe('buildClassifyChatCompletionBody', () => {
    it('monta o corpo com o texto do documento e tool_choice forçado', () => {
      const body = buildClassifyChatCompletionBody('MiniMax-M3', 'PGR da empresa XYZ, válido até 2027-01-01');

      expect(body.model).toBe('MiniMax-M3');
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'classify_document' } });
      expect(body.tools).toEqual([TOOL_SCHEMA]);
      expect(body.messages[1].content).toContain('PGR da empresa XYZ, válido até 2027-01-01');
    });
  });

  describe('parseClassifyToolCall', () => {
    it('extrai os 4 campos de um tool_call válido', () => {
      const body = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      category: 'pgr',
                      title: 'PGR 2026',
                      expires_at: '2027-01-01',
                      confidence: 'alta',
                    }),
                  },
                },
              ],
            },
          },
        ],
      };

      expect(parseClassifyToolCall(body)).toEqual({
        category: 'pgr',
        title: 'PGR 2026',
        expires_at: '2027-01-01',
        confidence: 'alta',
      });
    });

    it('devolve null quando não há tool_call', () => {
      expect(parseClassifyToolCall({ choices: [{ message: {} }] })).toBeNull();
    });

    it('devolve null quando o argumento não é JSON válido', () => {
      const body = { choices: [{ message: { tool_calls: [{ function: { arguments: 'não é json' } }] } }] };
      expect(parseClassifyToolCall(body)).toBeNull();
    });

    it('devolve null quando falta algum dos 4 campos', () => {
      const body = {
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ category: 'pgr' }) } }] } }],
      };
      expect(parseClassifyToolCall(body)).toBeNull();
    });
  });

  it('VALID_CATEGORIES bate exatamente com o @IsIn de CreateDocumentDto', () => {
    expect(VALID_CATEGORIES).toEqual(['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'ltcat', 'lip']);
  });
});
