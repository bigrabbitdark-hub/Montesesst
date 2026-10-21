'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { Interacoes } from './Interacoes';
import { atuacaoFetch, formatCnpj, SITUACAO_LABEL, SITUACAO_TONE, type ClienteFicha,
  type ClienteFinanceiroFicha, formatBRL, formatDataCurta, pagamentoLabel, pagamentoTone, textoAtraso } from '../../api';

const CAMPOS = [
  { key: 'trade_name', label: 'Nome fantasia', max: 200 },
  { key: 'sector', label: 'Setor', max: 200 },
  { key: 'contact_name', label: 'Nome do contato', max: 200 },
  { key: 'contact_role', label: 'Cargo do contato', max: 100 },
  { key: 'contact_phone', label: 'Telefone do contato', max: 30 },
] as const;
type Campo = (typeof CAMPOS)[number]['key'] | 'notes';
type Valores = Record<Campo, string>;

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';

function paraValores(f: ClienteFicha): Valores {
  return {
    trade_name: f.trade_name ?? '', sector: f.sector ?? '', contact_name: f.contact_name ?? '',
    contact_role: f.contact_role ?? '', contact_phone: f.contact_phone ?? '', notes: f.notes ?? '',
  };
}

function Fixo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-dash-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-dash-primary">{children}</dd>
    </div>
  );
}

// Cartão somente leitura: nenhum botão nem campo. Erro isolado (a ficha cadastral não depende dele).
function FinanceiroCard({ tenantId }: { tenantId: string }) {
  const [fin, setFin] = useState<ClienteFinanceiroFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    atuacaoFetch<ClienteFinanceiroFicha>(`/financeiro/clientes/${tenantId}`)
      .then((d) => {
        if (id !== ultima.current) return;
        if (!d || typeof d.situacao !== 'string') throw new Error('Dados financeiros indisponíveis.');
        setFin(d);
      })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [tenantId]);

  useEffect(carregar, [carregar]);

  return (
    <Card title="Financeiro">
      <p className="mb-3 text-xs font-semibold text-dash-muted">Somente consulta</p>
      <AsyncBody
        data={fin}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(f) => {
          const atraso = textoAtraso(f.dias_em_atraso ?? null);
          const pagamentos = Array.isArray(f.pagamentos) ? f.pagamentos : [];
          return (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Fixo label="Plano">{f.plano ?? '—'}</Fixo>
                <Fixo label="Valor mensal">{formatBRL(f.valor_mensal_cents)}</Fixo>
                <Fixo label="Situação">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={SITUACAO_TONE[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge>
                    {f.pendencia && <Badge tone="crit">Com pendência</Badge>}
                    {atraso && <span className="text-xs font-semibold text-dash-status-crit-text">{atraso}</span>}
                  </span>
                </Fixo>
              </dl>
              <h4 className="mb-2 mt-6 text-sm font-semibold text-dash-primary">Pagamentos recentes</h4>
              {pagamentos.length === 0 ? (
                <p className="text-sm text-dash-muted">Nenhum pagamento registrado.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {pagamentos.slice(0, 6).map((p, i) => (
                    <li key={`${p.data}-${i}`} className="flex flex-wrap items-center gap-2">
                      <span>{formatDataCurta(p.data)}</span>
                      <span>{formatBRL(p.valor_cents)}</span>
                      <Badge tone={pagamentoTone(p.status)}>{pagamentoLabel(p.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      />
    </Card>
  );
}

export default function FichaClientePage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [ficha, setFicha] = useState<ClienteFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [valores, setValores] = useState<Valores | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<ClienteFicha>(`/clientes/${tenantId}`)
      .then((f) => { setFicha(f); setValores(paraValores(f)); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(carregar, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valores || !ficha) return;
    setSalvando(true);
    setErroSalvar(null);
    setSucesso(false);
    setAviso(null);
    try {
      // Só o que mudou em relação à ficha carregada (campos NULL intocados não viram '').
      const original = paraValores(ficha!);
      const body: Partial<Valores> = {};
      (Object.keys(valores) as Campo[]).forEach((k) => {
        if (valores[k] !== original[k]) body[k] = valores[k];
      });
      if (Object.keys(body).length === 0) {
        setAviso('Nenhuma alteração para salvar.');
        return;
      }
      const atualizada = await atuacaoFetch<ClienteFicha>(`/clientes/${tenantId}`, { method: 'PATCH', body: JSON.stringify(body) });
      setFicha(atualizada);
      setValores(paraValores(atualizada));
      setSucesso(true);
    } catch (err) {
      setErroSalvar((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function mudar(campo: Campo, v: string) {
    setSucesso(false);
    setAviso(null);
    setValores((atual) => (atual ? { ...atual, [campo]: v } : atual));
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <Link href="/atuacao/clientes" className="mb-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2">
        Voltar para clientes
      </Link>
      <AsyncBody
        data={ficha}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-64 w-full"
        render={(f) => (
          <>
            <PageHeader titulo={f.name} descricao="Dados cadastrais ficam somente para leitura; contato e observações podem ser atualizados." />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Dados cadastrais (somente leitura)">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Fixo label="Razão social">{f.name}</Fixo>
                  <Fixo label="CNPJ">{formatCnpj(f.cnpj)}</Fixo>
                  <Fixo label="Plano">{f.plan}</Fixo>
                  <Fixo label="Situação"><Badge tone={SITUACAO_TONE[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge></Fixo>
                </dl>
                <h3 className="mb-2 mt-6 text-sm font-semibold text-dash-primary">Responsáveis Montese</h3>
                {(f.responsaveis ?? []).length === 0 ? (
                  <p className="text-sm text-dash-muted">Nenhum responsável atribuído.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {(f.responsaveis ?? []).map((r) => <li key={r.id} className="break-words">{r.full_name}</li>)}
                  </ul>
                )}
                <Link
                  href={`/atuacao/tarefas?tenantId=${f.id}`}
                  className="mt-2 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
                >
                  Ver tarefas deste cliente
                </Link>
                <br />
                <Link
                  href={`/atuacao/documentos?tenantId=${f.id}`}
                  className="mt-2 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
                >
                  Documentos deste cliente
                </Link>
                <h3 className="mb-2 mt-6 text-sm font-semibold text-dash-primary">Unidades</h3>
                {f.units.length === 0 ? (
                  <p className="text-sm text-dash-muted">Nenhuma unidade cadastrada.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {f.units.map((u) => (
                      <li key={u.id} className="break-words">{u.name} — {u.address_city}/{u.address_state}</li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Contato e observações">
                <form onSubmit={salvar} className="flex flex-col gap-3" noValidate>
                  {valores && CAMPOS.map((c) => (
                    <div key={c.key}>
                      <label htmlFor={c.key} className="mb-1 block text-sm font-medium text-dash-muted">{c.label}</label>
                      <input id={c.key} type="text" maxLength={c.max} value={valores[c.key]} onChange={(e) => mudar(c.key, e.target.value)} className={INPUT} />
                    </div>
                  ))}
                  {valores && (
                    <div>
                      <label htmlFor="notes" className="mb-1 block text-sm font-medium text-dash-muted">Observações</label>
                      <textarea id="notes" rows={4} maxLength={2000} value={valores.notes} onChange={(e) => mudar('notes', e.target.value)} className={INPUT} />
                    </div>
                  )}
                  {erroSalvar && <p role="alert" className="text-sm text-dash-status-crit-text">{erroSalvar}</p>}
                  {aviso && <p role="status" className="text-sm text-dash-muted">{aviso}</p>}
                  {sucesso && <p role="status" className="text-sm text-dash-status-ok-text">Dados atualizados.</p>}
                  <button
                    type="submit"
                    disabled={salvando}
                    className="self-start rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {salvando ? 'Salvando...' : 'Salvar'}
                  </button>
                </form>
              </Card>
              <FinanceiroCard tenantId={f.id} />
            </div>
            <Interacoes tenantId={f.id} />
          </>
        )}
      />
    </div>
  );
}
