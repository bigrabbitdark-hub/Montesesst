import { getToken } from '@/lib/auth';
import { EpiApiError } from './errors';
import { addDays, diffDays, todayDateOnly } from './format';
import type {
  AdjustInput, CaepiRecord, CreateEpiInput, CreateRequestResult, CreateSignatureRequestInput, DashboardQuery, Epi,
  EpiCatalogItem, EpiDashboard, EpiLot, EpiRow, EmployeeLite, Ficha, FichaDocument, FichaQuery, FichaVerify,
  InPersonInput, InPersonResult, IssueFichaInput, Movement, MovementsQuery, Page, PendingDelivery, PendingQuery,
  RegisterMovementInput, ReverseInput, SearchQuery, SignatureRequest, UpdateEpiInput,
} from './types';

// Único ponto de rede do módulo. Nada é gravado em localStorage/sessionStorage; o token é só lido.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new EpiApiError(
      res.status,
      typeof data?.message === 'string' ? data.message : '',
      typeof data?.attempts_left === 'number' ? data.attempts_left : undefined,
    );
  }
  if (res.status === 204) return undefined as T;
  // 2xx sem corpo (ex.: DELETE /epis/:id) é sucesso; só corpo não vazio que não seja JSON é resposta inesperada.
  const text = await res.text();
  if (text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new EpiApiError(res.status, '', undefined, true);
  }
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

// O backend recusa períodos acima de 366 dias (400). O cliente nunca envia janela maior: recua o início.
export const MAX_PERIOD_DAYS = 366;
export function clampPeriod(from?: string, to?: string, now: Date = new Date()): { from?: string; to?: string } {
  if (!from) return { from, to };
  const end = to ?? todayDateOnly(now);
  const clamped = diffDays(from, end) > MAX_PERIOD_DAYS ? addDays(end, -MAX_PERIOD_DAYS) : from;
  return { from: clamped, to };
}

const enc = encodeURIComponent;

export const epiApi = {
  dashboard: (q: DashboardQuery) => {
    const p = clampPeriod(q.from, q.to);
    return request<EpiDashboard>(`/epis/dashboard${qs({ tenant_id: q.tenantId, from: p.from, to: p.to, epi_id: q.epiId, employee_id: q.employeeId })}`);
  },
  getSettings: (tenantId?: string) => request<{ epi_alert_days: number }>(`/epis/settings${qs({ tenant_id: tenantId })}`),
  updateSettings: (days: number, tenantId?: string) =>
    request<{ epi_alert_days: number }>(`/epis/settings${qs({ tenant_id: tenantId })}`, json('PATCH', { epi_alert_days: days })),

  searchEpis: (q: SearchQuery) =>
    request<Page<EpiRow>>(`/epis/search${qs({
      tenant_id: q.tenantId, q: q.q, status: q.status, category: q.category, stock_band: q.stockBand, ca_alert: q.caAlert,
      page: q.page, page_size: q.pageSize,
    })}`),
  // Todas as páginas (100 por vez), no máximo 1000 EPIs; `truncated` avisa quando há mais que isso.
  searchAllEpis: async (tenantId?: string): Promise<{ items: EpiRow[]; truncated: boolean }> => {
    const items: EpiRow[] = [];
    let total = 0;
    for (let page = 1; page <= 10; page++) {
      const r = await epiApi.searchEpis({ tenantId, page, pageSize: 100 });
      items.push(...r.items);
      total = r.total;
      if (r.items.length === 0 || items.length >= total) break;
    }
    return { items: items.slice(0, 1000), truncated: total > 1000 };
  },
  createEpi: (body: CreateEpiInput) => request<Epi>('/epis', json('POST', body)),
  // DELETE /epis/:id: APAGA a linha definitivamente (não inativa; para inativar use updateEpi com status 'inativo'). 409 se houver entregas/movimentos. Sem tenant_id (RLS). 2xx sem corpo.
  deleteEpi: (id: string) => request<void>(`/epis/${enc(id)}`, { method: 'DELETE' }),
  updateEpi: (id: string, body: UpdateEpiInput) => request<Epi>(`/epis/${enc(id)}`, json('PATCH', body)),
  lots: (epiId: string) => request<EpiLot[]>(`/epis/${enc(epiId)}/lots`),
  catalog: () => request<EpiCatalogItem[]>('/epi-catalog-items'),
  caepiSearch: (q: string) => request<CaepiRecord[]>(`/caepi/search${qs({ q: q.trim() })}`),

  movements: (q: MovementsQuery) =>
    request<Page<Movement>>(`/epis/movements${qs({
      tenant_id: q.tenantId, tenant_epi_id: q.tenantEpiId, employee_id: q.employeeId, type: q.type, from: q.from, to: q.to,
      page: q.page, page_size: q.pageSize,
    })}`),
  registerMovement: (epiId: string, body: RegisterMovementInput) => request<Movement>(`/epis/${enc(epiId)}/movements`, json('POST', body)),
  adjust: (epiId: string, body: AdjustInput) => request<Movement>(`/epis/${enc(epiId)}/adjustments`, json('POST', body)),
  reverse: (movementId: string, body: ReverseInput) => request<Movement>(`/epis/movements/${enc(movementId)}/reversal`, json('POST', body)),

  // O backend devolve o funcionário inteiro (inclui cpf). Aqui só os campos não sensíveis passam adiante.
  employees: async (tenantId?: string): Promise<EmployeeLite[]> => {
    const rows = await request<Array<Record<string, unknown> & EmployeeLite>>(`/employees${qs({ tenant_id: tenantId })}`);
    return Array.isArray(rows)
      ? rows.map((r) => ({
          id: r.id, full_name: r.full_name, registration_number: r.registration_number ?? null,
          department: r.department ?? null, position: r.position ?? null, status: r.status,
        }))
      : [];
  },

  fichaGet: (employeeId: string, q: FichaQuery = {}) =>
    request<Ficha>(`/epi-fichas/employees/${enc(employeeId)}${qs({ from: q.from, to: q.to, signature_status: q.signature_status })}`),
  fichaIssue: (employeeId: string, body: IssueFichaInput) => request<FichaDocument>(`/epi-fichas/employees/${enc(employeeId)}/issue`, json('POST', body)),
  fichaDocuments: (employeeId: string) => request<FichaDocument[]>(`/epi-fichas/employees/${enc(employeeId)}/documents`),
  fichaVerify: (documentId: string) => request<FichaVerify>(`/epi-fichas/documents/${enc(documentId)}/verify`),

  createSignatureRequest: (body: CreateSignatureRequestInput) => request<CreateRequestResult>('/epi-signatures/requests', json('POST', body)),
  listSignatureRequests: (employeeId: string) => request<SignatureRequest[]>(`/epi-signatures/requests${qs({ employee_id: employeeId })}`),
  revokeSignatureRequest: (id: string) => request<{ id: string; status: string }>(`/epi-signatures/requests/${enc(id)}/revoke`, { method: 'POST' }),
  inPerson: (body: InPersonInput) => request<InPersonResult>('/epi-signatures/in-person', json('POST', body)),
  pending: (q: PendingQuery) =>
    request<Page<PendingDelivery>>(`/epi-signatures/pending${qs({ tenant_id: q.tenantId, employee_id: q.employeeId, page: q.page, page_size: q.pageSize })}`),
};

// Caminhos de PDFs autenticados (usar com openOrDownload; nunca como link público).
export const epiPaths = {
  fichaPreview: (employeeId: string, q: FichaQuery = {}) =>
    `/epi-fichas/employees/${enc(employeeId)}/preview.pdf${qs({ from: q.from, to: q.to, signature_status: q.signature_status })}`,
  fichaDownload: (documentId: string) => `/epi-fichas/documents/${enc(documentId)}/download`,
  receipt: (signatureId: string) => `/epi-signatures/${enc(signatureId)}/receipt.pdf`,
};

// Download/visualização autenticada: Blob -> URL temporária (revogada logo depois). Nunca URL pública.
export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new EpiApiError(res.status, typeof d?.message === 'string' ? d.message : '');
  }
  // Só PDF: ausência de Content-Type ou outro tipo (ex.: página HTML de erro de proxy) nunca é aberto.
  const ct = res.headers?.get?.('content-type');
  if (!ct || !/^application\/pdf\b/i.test(ct)) throw new EpiApiError(res.status, '', undefined, true);
  return new Blob([await res.blob()], { type: 'application/pdf' });
}

// Abra a aba ANTES do await (no clique do usuário) e passe em `win`: navegadores (Safari/iOS) bloqueiam window.open
// depois de uma chamada assíncrona. Sem `win`, tenta abrir; se o navegador bloquear, baixa o arquivo e devolve 'downloaded'
// para o chamador avisar o usuário.
export function openBlankWindow(): Window | null {
  const w = window.open('', '_blank');
  if (w) w.opener = null;
  return w;
}

export async function openOrDownload(
  path: string,
  opts: { filename?: string; mode: 'open' | 'download'; win?: Window | null },
): Promise<'opened' | 'downloaded'> {
  let blob: Blob;
  try {
    blob = await fetchBlob(path);
  } catch (e) {
    opts.win?.close();
    throw e;
  }
  const url = URL.createObjectURL(blob);
  let result: 'opened' | 'downloaded' = 'downloaded';
  try {
    if (opts.mode === 'open') {
      if (opts.win && !opts.win.closed) {
        opts.win.location.href = url;
        result = 'opened';
      } else {
        // window.open com 'noopener' devolve sempre null (especificação); por isso abre vazia, zera o opener e navega.
        const w = openBlankWindow();
        if (w) {
          w.location.href = url;
          result = 'opened';
        }
      }
    }
    if (result === 'downloaded') {
      opts.win?.close();
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.filename ?? 'documento.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return result;
}

export const downloadBlob = openOrDownload;
