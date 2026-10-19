// Cliente das rotas PÚBLICAS de assinatura de recebimento de EPI (celular do funcionário, sem login).
// O token e o código vão SEMPRE no corpo do POST, nunca na URL, e nada é guardado em localStorage/sessionStorage.
// As chamadas saem do navegador (não do servidor do Next) para o limite por IP enxergar o IP real.
export type OpenData = {
  employee_name: string;
  expires_at: string;
  attempts_left: number;
  items: {
    delivery_id: string;
    date: string;
    epi_description: string;
    manufacturer: string | null;
    model: string | null;
    ca_number: string;
    quantity: number | null;
  }[];
  term: { version: string; draft: boolean; title: string; paragraphs: string[] };
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public attemptsLeft?: number,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/epi-signatures/public/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data?.message === 'string' ? data.message : 'Não foi possível concluir a operação',
      typeof data?.attempts_left === 'number' ? data.attempts_left : undefined,
    );
  }
  return data as T;
}

export const peek = (token: string) => post<{ usable: boolean; company_name?: string }>('peek', { token });
export const openLink = (token: string, code: string) => post<OpenData>('open', { token, code });
export const sign = (token: string, code: string, termVersion: string, png: string) =>
  post<{ receipt_code: string; signed_at: string; evidence_sha256?: string }>('sign', {
    token,
    code,
    accepted: true,
    term_version: termVersion,
    signature_png_base64: png.replace(/^data:image\/png;base64,/, ''),
  });
export const refuse = (token: string, code: string, reason?: string) =>
  post<{ status: string }>('refuse', { token, code, ...(reason ? { reason } : {}) });
