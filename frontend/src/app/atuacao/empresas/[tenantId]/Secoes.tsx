'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Dialogo } from '@/app/admin/documentos-fluxo/Dialogo';
import {
  atuacaoFetch,
  docCategoriaLabel, docStatusLabel, docStatusTone, type DocTecnico,
  type EmpresaDocumento, type EmpresaEpi, type EmpresaFuncionario, type EmpresaVencimento, type EmpresaVisaoGeral,
} from '../../api';

const BTN =
  'rounded-md border border-dash-border-input px-3 py-1.5 text-xs font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const BTN_PRIMARIO =
  'rounded-md bg-dash-primary px-3 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const CARTAO = 'rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]';

// Carrega uma rota da empresa; respostas atrasadas (rota/empresa antigas) são ignoradas.
function useCarga<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const carregar = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    atuacaoFetch<T>(path)
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e: Error) => { if (id === seq.current) { setData(null); setError(e.message); } })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [path]);
  useEffect(carregar, [carregar]);
  return { data, error, loading, carregar };
}

function dataBr(v: string | null): string {
  const m = v && /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const SITUACAO_DOC: Record<string, { label: string; tone: Tone }> = {
  valido: { label: 'Válido', tone: 'ok' },
  vencendo: { label: 'A vencer', tone: 'warn' },
  vencido: { label: 'Vencido', tone: 'crit' },
  sem_vencimento: { label: 'Sem vencimento', tone: 'info' },
};

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-dash-muted">{children}</p>;
}

export function VisaoGeral({ visao }: { visao: EmpresaVisaoGeral }) {
  const itens: [string, number][] = [
    ['Funcionários ativos', visao.funcionarios_ativos],
    ['Documentos', visao.documentos.total],
    ['Documentos vencidos', visao.documentos.vencidos],
    ['Documentos a vencer em 30 dias', visao.documentos.a_vencer_30d],
    ['EPIs cadastrados', visao.epis_cadastrados],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} className={CARTAO}>
          <dt className="text-xs font-medium text-dash-muted">{rotulo}</dt>
          <dd className="mt-1 text-2xl font-bold text-dash-primary">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
function dataValida(v: string): boolean {
  if (!REGEX_DATA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function DialogoVigencia({ tenantId, doc, onFechar, onSalvo }: {
  tenantId: string; doc: EmpresaDocumento; onFechar: () => void; onSalvo: () => void;
}) {
  const [inicio, setInicio] = useState(doc.valid_from ?? '');
  const [fim, setFim] = useState(doc.expires_at ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    const corpo: { valid_from?: string | null; expires_at?: string | null } = {};
    const i = inicio.trim();
    const f = fim.trim();
    if (i !== (doc.valid_from ?? '')) corpo.valid_from = i === '' ? null : i;
    if (f !== (doc.expires_at ?? '')) corpo.expires_at = f === '' ? null : f;
    if (Object.keys(corpo).length === 0) { setErro('Altere ao menos uma das datas antes de salvar.'); return; }
    for (const [campo, v] of Object.entries(corpo)) {
      if (v !== null && v !== undefined && !dataValida(v)) {
        setErro(`${campo === 'valid_from' ? 'Início' : 'Vencimento'}: use o formato AAAA-MM-DD (ex.: 2027-06-30) com uma data real.`);
        return;
      }
    }
    setErro(null);
    setOcupado(true);
    try {
      await atuacaoFetch(`/empresas/${tenantId}/documentos/${doc.id}/vigencia`, { method: 'PATCH', body: JSON.stringify(corpo) });
      onSalvo();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo={`Ajustar vigência: ${doc.title}`} onFechar={onFechar} ocupado={ocupado}>
      <form onSubmit={salvar} noValidate>
        <p className="mb-3 text-sm text-dash-muted">Informe as datas no formato AAAA-MM-DD. Deixe em branco para remover a data.</p>
        <p className="mb-3 text-sm text-dash-muted">Alterar apenas &apos;Válido desde&apos; pode recalcular o vencimento pela regra do tipo de documento.</p>
        <div className="mb-3">
          <label htmlFor="vig-inicio" className="mb-1 block text-sm font-medium">Válido desde</label>
          <input id="vig-inicio" className={INPUT} inputMode="numeric" placeholder="AAAA-MM-DD" value={inicio}
            disabled={ocupado} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="mb-3">
          <label htmlFor="vig-fim" className="mb-1 block text-sm font-medium">Vence em</label>
          <input id="vig-fim" className={INPUT} inputMode="numeric" placeholder="AAAA-MM-DD" value={fim}
            disabled={ocupado} onChange={(e) => setFim(e.target.value)} />
        </div>
        {erro && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onFechar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className={BTN_PRIMARIO} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}

export function Documentos({ tenantId, onVigenciaAlterada }: { tenantId: string; onVigenciaAlterada?: () => void }) {
  const { data, error, loading, carregar } = useCarga<EmpresaDocumento[]>(`/empresas/${tenantId}/documentos`);
  const [alvo, setAlvo] = useState<EmpresaDocumento | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroBaixar, setErroBaixar] = useState<string | null>(null);

  async function baixar(d: EmpresaDocumento) {
    if (baixando) return;
    setBaixando(d.id);
    setErroBaixar(null);
    try {
      const r = await atuacaoFetch<{ url: string }>(`/empresas/${tenantId}/documentos/${d.id}/download`);
      // Âncora temporária: após o await o window.open perderia o gesto do usuário e poderia ser bloqueado em silêncio.
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErroBaixar((e as Error).message);
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div>
      {aviso && <p role="status" className="mb-3 text-sm font-medium text-dash-status-ok-text">{aviso}</p>}
      {erroBaixar && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erroBaixar}</p>}
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        render={(lista) =>
          lista.length === 0 ? (
            <Vazio>Nenhum documento cadastrado.</Vazio>
          ) : (
            <ul className="flex flex-col gap-3">
              {lista.map((d) => {
                const s = SITUACAO_DOC[d.situacao] ?? { label: d.situacao, tone: 'info' as Tone };
                return (
                  <li key={d.id} className={CARTAO}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-dash-primary">{d.title}</p>
                        <p className="break-words text-xs text-dash-muted">{d.category} · {d.file_name}</p>
                      </div>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-2 text-sm">Início: {dataBr(d.valid_from)} · Vencimento: {dataBr(d.expires_at)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={BTN} disabled={baixando !== null} onClick={() => baixar(d)}>
                        {baixando === d.id ? 'Baixando…' : `Baixar ${d.title}`}
                      </button>
                      <button type="button" className={BTN} onClick={() => { setAviso(null); setAlvo(d); }}>
                        Ajustar vigência<span className="sr-only"> de {d.title}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      />
      {alvo && (
        <DialogoVigencia
          tenantId={tenantId}
          doc={alvo}
          onFechar={() => setAlvo(null)}
          onSalvo={() => { setAlvo(null); setAviso('Vigência atualizada.'); carregar(); onVigenciaAlterada?.(); }}
        />
      )}
    </div>
  );
}

export function Vencimentos({ tenantId }: { tenantId: string }) {
  const { data, error, loading, carregar } = useCarga<EmpresaVencimento[]>(`/empresas/${tenantId}/vencimentos`);
  return (
    <AsyncBody
      data={data}
      error={error}
      loading={loading}
      onRetry={carregar}
      render={(lista) =>
        lista.length === 0 ? (
          <Vazio>Nenhum documento com vencimento cadastrado.</Vazio>
        ) : (
          <ul className="flex flex-col gap-3">
            {lista.map((v) => {
              const dias = v.dias_para_vencer;
              const vencido = dias < 0;
              const aVencer = !vencido && dias <= 30;
              const texto = vencido
                ? `Vencido há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}`
                : dias === 0 ? 'Vence hoje' : `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
              return (
                <li key={v.id} className={CARTAO}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-dash-primary">{v.title}</p>
                      <p className="text-xs text-dash-muted">{v.category} · {dataBr(v.expires_at)}</p>
                    </div>
                    <Badge tone={vencido ? 'crit' : aVencer ? 'warn' : 'ok'}>
                      {vencido ? 'Vencido' : aVencer ? 'A vencer' : 'Em dia'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm">{texto}</p>
                </li>
              );
            })}
          </ul>
        )
      }
    />
  );
}

export function Funcionarios({ tenantId }: { tenantId: string }) {
  const { data, error, loading, carregar } = useCarga<EmpresaFuncionario[]>(`/empresas/${tenantId}/funcionarios`);
  return (
    <AsyncBody
      data={data}
      error={error}
      loading={loading}
      onRetry={carregar}
      render={(lista) =>
        lista.length === 0 ? (
          <Vazio>Nenhum funcionário cadastrado.</Vazio>
        ) : (
          <ul className="flex flex-col gap-3">
            {lista.map((f) => (
              <li key={f.id} className={CARTAO}>
                <p className="break-words font-semibold text-dash-primary">{f.full_name}</p>
                <p className="break-words text-sm text-dash-muted">{f.cargo ?? 'Sem cargo'} · {f.department ?? 'Sem setor'}</p>
                <p className="text-xs text-dash-muted">Admissão: {dataBr(f.admission_date)} · Situação: {f.status}</p>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

export function Epis({ tenantId }: { tenantId: string }) {
  const { data, error, loading, carregar } = useCarga<EmpresaEpi[]>(`/empresas/${tenantId}/epi`);
  return (
    <AsyncBody
      data={data}
      error={error}
      loading={loading}
      onRetry={carregar}
      render={(lista) =>
        lista.length === 0 ? (
          <Vazio>Nenhum EPI cadastrado.</Vazio>
        ) : (
          <ul className="flex flex-col gap-3">
            {lista.map((e) => (
              <li key={e.id} className={CARTAO}>
                <p className="break-words font-semibold text-dash-primary">{e.description}</p>
                <p className="text-sm text-dash-muted">{e.equipment_group} · CA {e.code}</p>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

const ORDEM_TECNICOS = ['pgr', 'ltcat', 'lip', 'laudo', 'pcmso'];

// Visão por empresa dos documentos técnicos: o mais recente de cada tipo, com etapa, correções e avisos do PGR-base.
export function Tecnicos({ tenantId }: { tenantId: string }) {
  const { data, error, loading, carregar } = useCarga<DocTecnico[]>(`/documentos/empresa/${tenantId}/tecnicos`);
  return (
    <AsyncBody
      data={data}
      error={error}
      loading={loading}
      onRetry={carregar}
      render={(lista) => {
        const porTipo = new Map(lista.map((d) => [d.category, d]));
        return (
          <ul className="grid gap-3 sm:grid-cols-2">
            {ORDEM_TECNICOS.map((cat) => {
              const d = porTipo.get(cat);
              return (
                <li key={cat} className={CARTAO}>
                  <p className="text-xs font-semibold uppercase text-dash-muted">{docCategoriaLabel(cat)}</p>
                  {!d ? (
                    <p className="mt-1 text-sm text-dash-muted">Nenhum documento deste tipo.</p>
                  ) : (
                    <>
                      <p className="mt-1 break-words font-semibold text-dash-primary">
                        <Link href={`/atuacao/documentos/${d.id}`} className="underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary">{d.title}</Link>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={docStatusTone(d.status)}>{docStatusLabel(d.status)}</Badge>
                        {d.versao !== null && <span className="text-xs text-dash-muted">versão {d.versao}</span>}
                        {d.correcoes_pendentes > 0 && (
                          <Badge tone="warn">{d.correcoes_pendentes} {d.correcoes_pendentes === 1 ? 'correção pendente' : 'correções pendentes'}</Badge>
                        )}
                      </p>
                      {d.avisos_base.map((a) => <p key={a.codigo} className="mt-2 text-xs text-dash-primary">⚠ {a.mensagem}</p>)}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        );
      }}
    />
  );
}
