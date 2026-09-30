import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PenteFinoPanel } from '../PenteFinoPanel';

const report = {
  pgr_document: null,
  pcmso_document: null,
  ltcat_document: null,
  lip_document: null,
  functions: [],
  lip_agents: [],
  agent_coverage: [],
  warnings: [],
  audit_findings: [
    {
      id: 'quantitative_divergence:ruido-continuo',
      type: 'quantitative_divergence',
      status: 'inconsistency',
      confidence: 'high',
      summary: 'Ruído contínuo: valores divergentes a esclarecer.',
      evidence: [
        {
          document_id: 'doc-lip',
          title: 'LIP 2026',
          source_excerpt: 'Ruído contínuo medido em 91,62 dB(A).',
          page: null,
        },
      ],
      limitations: ['A diferença não determina, por si só, erro técnico.'],
      recommended_verification: 'Conferir os relatórios de medição.',
    },
  ],
};

function response(body: unknown, status = 201, headers = new Headers()): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  } as Response;
}

describe('PenteFinoPanel no Assistente', () => {
  beforeEach(() => {
    localStorage.setItem('montese_token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('só executa a auditoria após clique e apresenta as evidências disponíveis', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(report));
    vi.stubGlobal('fetch', fetchMock);

    render(<PenteFinoPanel presentation="assistant" />);

    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Executar Auditoria Montese' }));

    expect(await screen.findByText('Ruído contínuo: valores divergentes a esclarecer.')).toBeTruthy();
    expect(screen.getByText(/Confiança Alta/)).toBeTruthy();
    fireEvent.click(screen.getByText('Ver evidências e verificação recomendada'));
    expect(screen.getByText(/Ruído contínuo medido em 91,62 dB\(A\)/)).toBeTruthy();
    expect(screen.getByText(/Página não capturada/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pente-fino/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('informa o limite de execuções sem apresentar achados antigos como atuais', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ message: 'rate limited' }, 429, new Headers({ 'Retry-After': '120' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<PenteFinoPanel presentation="assistant" />);
    fireEvent.click(screen.getByRole('button', { name: 'Executar Auditoria Montese' }));

    expect(await screen.findByText(/limite de execuções da Auditoria Montese/i)).toBeTruthy();
    expect(screen.getByText(/2 minuto/)).toBeTruthy();
  });

  it('mostra erro de conexão quando a execução falha na rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<PenteFinoPanel presentation="assistant" />);
    fireEvent.click(screen.getByRole('button', { name: 'Executar Auditoria Montese' }));

    expect(await screen.findByText('Não foi possível conectar ao servidor.')).toBeTruthy();
  });
});