'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, CHECKLIST_SERVICOS, checklistServicoLabel, type ChecklistModeloResumo, type ChecklistServico, type ChecklistVersao,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const LINK = 'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

export default function ChecklistsPage() {
  const router = useRouter();
  const [lista, setLista] = useState<ChecklistModeloResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<ChecklistServico>('pgr');
  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const emVoo = useRef(false);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    return atuacaoFetch<ChecklistModeloResumo[]>('/checklists/modelos')
      .then(setLista)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (emVoo.current) return;
    if (!nome.trim()) { setErroCriar('Informe o nome do modelo.'); return; }
    emVoo.current = true;
    setCriando(true);
    setErroCriar(null);
    try {
      const v = await atuacaoFetch<ChecklistVersao>('/checklists/modelos', { method: 'POST', body: JSON.stringify({ service, name: nome.trim() }) });
      router.push(`/atuacao/checklists/versoes/${v.id}`);
    } catch (err) {
      setErroCriar((err as Error).message);
    } finally {
      emVoo.current = false;
      setCriando(false);
    }
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Checklists por serviço" descricao="Modelos de checklist aprovados pela engenheira. Um modelo só pode ser usado em documentos depois de aprovado." />
      <Card className="mb-6">
        <form onSubmit={criar} noValidate className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="cm-servico" className={LABEL}>Serviço</label>
            <select id="cm-servico" value={service} onChange={(e) => setService(e.target.value as ChecklistServico)} className={INPUT}>
              {CHECKLIST_SERVICOS.map((s) => <option key={s} value={s}>{checklistServicoLabel(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cm-nome" className={LABEL}>Nome do novo modelo</label>
            <input id="cm-nome" type="text" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} />
          </div>
          <button type="submit" disabled={criando} className={BTN}>{criando ? 'Criando…' : 'Criar modelo'}</button>
          {erroCriar && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-3">{erroCriar}</p>}
        </form>
      </Card>
      <AsyncBody
        data={lista}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-40 w-full"
        render={(modelos) => modelos.length === 0 ? (
          <p className="text-sm text-dash-muted">Nenhum modelo cadastrado ainda. Crie o primeiro acima; os itens são definidos e aprovados pela engenheira.</p>
        ) : (
          <ul aria-label="Modelos de checklist" className="flex flex-col gap-3">
            {modelos.map((m) => (
              <li key={m.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold text-dash-primary">{m.name}</span>
                  <span className="text-sm text-dash-muted">{checklistServicoLabel(m.service)}</span>
                  {m.versao_aprovada ? <Badge tone="ok">{`Aprovado v${m.versao_aprovada}`}</Badge> : <Badge tone="high">Sem versão aprovada</Badge>}
                  {m.rascunho_id && <Badge tone="warn">Rascunho em edição</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {m.versao_aprovada_id && <Link href={`/atuacao/checklists/versoes/${m.versao_aprovada_id}`} className={LINK}>Ver versão aprovada</Link>}
                  {m.rascunho_id && <Link href={`/atuacao/checklists/versoes/${m.rascunho_id}`} className={LINK}>Abrir rascunho</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
