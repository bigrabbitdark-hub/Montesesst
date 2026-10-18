'use client';

import { useState } from 'react';
import { AdminIcon } from '@/components/admin/icons';
import { Badge, Card, type Tone } from '@/components/admin/Card';
import type { AiProviderView } from '@/lib/admin/ai-config';
import { testProvider, upsertProvider } from '@/lib/admin/ai-config';

// Card de UM provedor (MiniMax/OpenRouter/Groq) — exibe status, chave
// mascarada, modelo ativo e formulário inline pra trocar chave/modelo.
// Fluxo: salva via PUT → testa via POST /test → mostra feedback.
// A chave NUNCA persiste no estado global nem em localStorage.

export function ProviderCard({
  view,
  onSaved,
}: {
  view: AiProviderView;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(view.model);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const sourceTone: Tone = view.source === 'db' ? 'ok' : view.source === 'env' ? 'warn' : 'neutral';
  const sourceLabel = view.source === 'db' ? 'Configurado' : view.source === 'env' ? 'Fallback env' : 'Sem chave';

  async function handleSave() {
    if (!apiKey.trim()) {
      setFeedback({ tone: 'bad', text: 'Informe a chave de API.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await upsertProvider(view.provider, apiKey.trim(), model.trim());
      setApiKey('');
      setFeedback({ tone: 'ok', text: 'Salvo. A chave está cifrada em repouso.' });
      onSaved();
    } catch (err) {
      setFeedback({ tone: 'bad', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setFeedback(null);
    try {
      const r = await testProvider(view.provider);
      setFeedback({ tone: r.ok ? 'ok' : 'bad', text: `${r.detail} (modelo: ${r.model})` });
    } catch (err) {
      setFeedback({ tone: 'bad', text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card
      id={`ia-${view.provider}`}
      title={view.providerLabel}
      subtitle={view.apiKeyMasked ? `Chave salva: ${view.apiKeyMasked}` : 'Nenhuma chave salva.'}
      action={<Badge tone={sourceTone}>{sourceLabel}</Badge>}
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-brand-700">Modelo</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="ex.: MiniMax-M3, anthropic/claude-sonnet-5"
            className="rounded-md border border-brand-100 bg-white px-3 py-2 text-brand-900 outline-none focus:border-adm-brand"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-brand-700">Nova chave de API</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Cole a chave aqui (não fica salva no navegador)"
            className="rounded-md border border-brand-100 bg-white px-3 py-2 font-mono text-brand-900 outline-none focus:border-adm-brand"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-adm-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-adm-brand/90 disabled:opacity-50"
          >
            <AdminIcon name="check" className="h-3.5 w-3.5" />
            {saving ? 'Salvando…' : 'Salvar chave'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-50 disabled:opacity-50"
          >
            <AdminIcon name="refresh" className="h-3.5 w-3.5" />
            {testing ? 'Testando…' : 'Testar conexão'}
          </button>
          {view.updatedAt && (
            <span className="text-xs text-brand-700">
              Atualizado {new Date(view.updatedAt).toLocaleString('pt-BR')}
            </span>
          )}
        </div>

        {feedback && (
          <p
            role={feedback.tone === 'bad' ? 'alert' : 'status'}
            className={`rounded-md px-3 py-2 text-xs ${
              feedback.tone === 'ok'
                ? 'border border-adm-status-ok/30 bg-adm-status-ok-bg text-adm-status-ok-text'
                : 'border border-adm-status-crit/30 bg-adm-status-crit-bg text-adm-status-crit-text'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </Card>
  );
}
