import {
  buildDocumentChecklistChatCompletionBody,
  parseDocumentChecklistToolCall,
  TOOL_SCHEMA,
} from '../src/pente-fino/document-checklist-shared';

describe('document-checklist-shared', () => {
  describe('buildDocumentChecklistChatCompletionBody', () => {
    it('monta o corpo com o texto do documento e tool_choice forçado', () => {
      const body = buildDocumentChecklistChatCompletionBody('modelo-teste', 'texto do PGR elaborado em 2025');
      expect(body.model).toBe('modelo-teste');
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'extract_document_checklist' } });
      expect(body.tools).toEqual([TOOL_SCHEMA]);
      expect(body.messages[1].content).toContain('texto do PGR elaborado em 2025');
    });
  });

  describe('parseDocumentChecklistToolCall', () => {
    it('extrai os campos de um tool_call válido', () => {
      const body = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      elaboration_date: '2025-03-15',
                      elaboration_date_excerpt: 'elaborado em 15 de março de 2025',
                      professional_name: 'João Silva',
                      professional_registro: 'CREA-12345',
                      professional_papel: 'Engenheiro de Segurança do Trabalho',
                      professional_excerpt: 'João Silva, CREA-12345, Engenheiro de Segurança do Trabalho',
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
      expect(parseDocumentChecklistToolCall(body)).toEqual({
        elaboration_date: '2025-03-15',
        elaboration_date_excerpt: 'elaborado em 15 de março de 2025',
        professional_name: 'João Silva',
        professional_registro: 'CREA-12345',
        professional_papel: 'Engenheiro de Segurança do Trabalho',
        professional_excerpt: 'João Silva, CREA-12345, Engenheiro de Segurança do Trabalho',
      });
    });

    it('devolve null pra resposta sem tool_call', () => {
      expect(parseDocumentChecklistToolCall({ choices: [{ message: {} }] })).toBeNull();
    });
  });
});
