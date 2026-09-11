import { buildExtractChatCompletionBody, parseExtractToolCall, TOOL_SCHEMA } from '../src/pente-fino/function-extraction-shared';

describe('function-extraction-shared', () => {
  describe('buildExtractChatCompletionBody', () => {
    it('monta o corpo com o texto do documento e tool_choice forçado, rótulo "risco" pro PGR', () => {
      const body = buildExtractChatCompletionBody('modelo-teste', 'texto do PGR com Soldador exposto a fumos', 'risco');
      expect(body.model).toBe('modelo-teste');
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'extract_function_items' } });
      expect(body.tools).toEqual([TOOL_SCHEMA]);
      expect(body.messages[0].content).toContain('risco');
      expect(body.messages[1].content).toContain('texto do PGR com Soldador exposto a fumos');
    });

    it('usa rótulo "exame" pro PCMSO', () => {
      const body = buildExtractChatCompletionBody('modelo-teste', 'texto do PCMSO', 'exame');
      expect(body.messages[0].content).toContain('exame');
    });
  });

  describe('parseExtractToolCall', () => {
    it('extrai a lista de items de um tool_call válido', () => {
      const body = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      items: [{ function_text: 'Soldador', description: 'Fumos metálicos', source_excerpt: 'trecho' }],
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
      expect(parseExtractToolCall(body)).toEqual({
        items: [{ function_text: 'Soldador', description: 'Fumos metálicos', source_excerpt: 'trecho' }],
      });
    });

    it('devolve null pra resposta sem tool_call', () => {
      expect(parseExtractToolCall({ choices: [{ message: {} }] })).toBeNull();
    });
  });
});
