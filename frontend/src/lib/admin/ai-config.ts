// Cliente do painel /admin/ia — espelha o backend em
// backend/src/ai-config/ai-config.controller.ts. Tipos alinhados com
// AiProviderAdminView / AiProviderId (backend/src/ai-config/ai-config.types.ts).
//
// A chave NUNCA trafega em claro pela UI — o backend mascara antes de
// devolver, e o PUT envia a chave em texto (HTTPS só). O frontend
// mantém a chave em estado local só até o PUT responder; nada vai pra
// localStorage.

import { getToken } from '@/lib/auth';

export type AiProviderId = 'minimax' | 'openrouter' | 'groq';
export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  groq: 'Groq',
};

export type AiProviderSource = 'db' | 'env' | 'none';

export interface AiProviderView {
  provider: AiProviderId;
  providerLabel: string;
  configured: boolean;
  source: AiProviderSource;
  model: string;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface AiTestResult {
  ok: boolean;
  detail: string;
  model: string;
}

async function authedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('sem sessão');
  }
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('sessão expirada');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function listProviders(): Promise<AiProviderView[]> {
  return authedRequest<AiProviderView[]>('/api/admin/ai-config');
}

export function upsertProvider(provider: AiProviderId, apiKey: string, model: string): Promise<{ ok: true; provider: string; model: string }> {
  return authedRequest(`/api/admin/ai-config/${provider}`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey, model }),
  });
}

export function testProvider(provider: AiProviderId): Promise<AiTestResult> {
  return authedRequest<AiTestResult>(`/api/admin/ai-config/${provider}/test`, { method: 'POST' });
}
