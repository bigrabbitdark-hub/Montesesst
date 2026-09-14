import {
  ALLOWED_CATEGORIES,
  TOOL_SCHEMA,
  buildLipAgentChatCompletionBody,
  parseLipAgentToolCall,
} from '../src/pente-fino/lip-agent-extraction-shared';

describe('lip-agent-extraction-shared', () => {
  it('ALLOWED_CATEGORIES tem exatamente as 6 categorias esperadas', () => {
    expect(ALLOWED_CATEGORIES).toEqual(['ruido', 'calor', 'vibracao', 'quimico', 'biologico', 'outro']);
  });

  it('buildLipAgentChatCompletionBody monta o corpo com tool_choice forçado pra extract_lip_agents', () => {
    const body = buildLipAgentChatCompletionBody('MiniMax-M3', 'texto do documento');
    expect(body.model).toBe('MiniMax-M3');
    expect(body.tools).toEqual([TOOL_SCHEMA]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'extract_lip_agents' } });
    expect(body.messages[1].content).toContain('texto do documento');
  });

  it('parseLipAgentToolCall extrai os argumentos do tool_call', () => {
    const fakeResponse = {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { arguments: JSON.stringify({ agents: [{ agent_name_raw: 'Ruído' }] }) } },
            ],
          },
        },
      ],
    };
    expect(parseLipAgentToolCall(fakeResponse)).toEqual({ agents: [{ agent_name_raw: 'Ruído' }] });
  });

  it('parseLipAgentToolCall devolve null quando não há tool_call', () => {
    expect(parseLipAgentToolCall({ choices: [{ message: {} }] })).toBeNull();
  });

  it('parseLipAgentToolCall devolve null quando os argumentos não são JSON válido', () => {
    const fakeResponse = { choices: [{ message: { tool_calls: [{ function: { arguments: '{invalido' } }] } }] };
    expect(parseLipAgentToolCall(fakeResponse)).toBeNull();
  });
});
