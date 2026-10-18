// Identificadores canônicos dos 3 provedores integrados hoje. Adicionar um
// novo provedor exige: (1) nova entrada aqui, (2) envKeyVar/envModelVar/
// getDefaultModel no service, (3) endpoint de teste em testConnection().
export type AiProviderId = 'minimax' | 'openrouter' | 'groq';

export const AI_PROVIDERS: readonly AiProviderId[] = ['minimax', 'openrouter', 'groq'] as const;

// Resolução final que os services consumidores (ai-copilot, cipa, normative)
// consomem. apiKey é null quando o provider não está configurado em lugar
// nenhum (nem banco, nem env var) — o consumer lança ServiceUnavailableException
// nesse caso, mesmo padrão dos services hoje.
export interface ResolvedAiConfig {
  provider: AiProviderId;
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
}

// Forma serializada pro painel /admin/ia. NUNCA contém apiKey em claro —
// apiKeyMasked só mostra prefixo+sufixo (ex: "sk-…XYZW"). source distingue
// "db" (configurado no painel, sobrescreve env) de "env" (cai no fallback).
export interface AiProviderAdminView {
  provider: AiProviderId;
  providerLabel: string;
  configured: boolean;
  source: 'db' | 'env' | 'none';
  model: string;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export const AI_PROVIDER_LABEL: Record<AiProviderId, string> = {
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  groq: 'Groq',
};
