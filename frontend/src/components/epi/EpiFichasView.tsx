'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EpiApiError } from '@/lib/epi/errors';
import { epiApi, epiPaths, openBlankWindow, openOrDownload } from '@/lib/epi/api';
import { formatCnpj } from '@/lib/cnpj';
import { formatDate, formatDateTime, formatQty } from '@/lib/epi/format';
import { newIdempotencyKey } from '@/lib/epi/idempotency';
import type { EmployeeLite, Ficha, FichaDocument, FichaLine, FichaQuery, FichaVerify, SignatureStatus } from '@/lib/epi/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { SignatureLinkDialog } from './SignatureLinkDialog';
import { InPersonDialog } from './InPersonDialog';
import { ActiveLinks } from './ActiveLinks';
import { SignatureStatusBadge } from './SignatureStatusBadge';
import { MOVEMENT_LABEL } from './EpiDashboardView';
import { mapFichaError, type FichaCtx } from './fichaErrors';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from './styles';

const STATUS_OPTIONS: Array<[SignatureStatus, string]> = [
  ['pendente', 'Pendente'], ['assinada', 'Assinada'], ['presencial', 'Presencial'], ['recusada', 'Recusada'],
  ['expirada', 'Expirada'], ['estornada', 'Estornada'], ['legado', 'Anterior ao módulo'],
];
const LINE_TYPE: Record<FichaLine['type'], string> = { ...MOVEMENT_LABEL, entrega_legada: 'Entrega anterior ao módulo' };
const NOT_INFORMED = 'não informada';

const VERIFY_VIEW: Record<FichaVerify['status'], { tone: 'ok' | 'crit' | 'warn'; label: string; text: string }> = {
  integro: { tone: 'ok', label: 'Íntegro', text: 'O arquivo guardado confere com o registro da emissão.' },
  divergente: { tone: 'crit', label: 'Divergente', text: 'O arquivo guardado NÃO confere com o registro da emissão. Não use este documento e avise o suporte.' },
  arquivo_ausente: { tone: 'warn', label: 'Arquivo ausente', text: 'O registro existe, mas o arquivo não foi encontrado no armazenamento. Avise o suporte.' },
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const orNot = (v: string | null | undefined) => (v && v.trim() ? v : NOT_INFORMED);

interface Props { tenantId?: string }

// Trocar de empresa remonta a view: funcionário, filtros, ficha, versões e consultas em voo da empresa anterior somem.
export function EpiFichasView(props: Props) {
  return <EpiFichasInner key={props.tenantId ?? ''} {...props} />;
}

function EpiFichasInner({ tenantId }: Props) {
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [empError, setEmpError] = useState<string | null>(null);
  const [empTry, setEmpTry] = useState(0);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<SignatureStatus | ''>('');
  const periodInvalid = from !== '' && to !== '' && from > to;

  useEffect(() => {
    let alive = true;
    setEmpError(null);
    epiApi.employees(tenantId).then((r) => { if (alive) setEmployees(r); }).catch((e) => { if (alive) setEmpError(mapFichaError(e, 'funcionarios')); });
    return () => { alive = false; };
  }, [tenantId, empTry]);

  const options = useMemo(() => {
    const q = norm(search.trim());
    return employees.filter((e) => e.id === employeeId || !q || norm(e.full_name).includes(q));
  }, [employees, search, employeeId]);

  // ---- ficha (contador de geração: resposta de outro funcionário/filtro é descartada)
  const [loaded, setLoaded] = useState<{ employeeId: string; ficha: Ficha } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const fichaGen = useRef(0);
  const query: FichaQuery = useMemo(
    () => ({ from: from || undefined, to: to || undefined, signature_status: status || undefined }),
    [from, to, status],
  );

  useEffect(() => {
    const mine = ++fichaGen.current;
    if (!employeeId || periodInvalid) { setLoading(false); setError(null); return; }
    setLoading(true);
    setError(null);
    epiApi.fichaGet(employeeId, query)
      .then((f) => { if (mine === fichaGen.current) { setLoaded({ employeeId, ficha: f }); setLoading(false); } })
      .catch((e) => { if (mine === fichaGen.current) { setError(mapFichaError(e, 'carregar')); setLoading(false); } });
  }, [employeeId, query, periodInvalid, reload]);
  useEffect(() => () => { fichaGen.current += 1; }, []);

  // ---- versões emitidas
  const [docs, setDocs] = useState<{ employeeId: string; items: FichaDocument[] } | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsTick, setDocsTick] = useState(0);
  const docsGen = useRef(0);
  useEffect(() => {
    const mine = ++docsGen.current;
    setDocsError(null);
    if (!employeeId) return;
    epiApi.fichaDocuments(employeeId)
      .then((items) => { if (mine === docsGen.current) setDocs({ employeeId, items }); })
      .catch((e) => { if (mine === docsGen.current) setDocsError(mapFichaError(e, 'carregar')); });
  }, [employeeId, docsTick]);
  useEffect(() => () => { docsGen.current += 1; }, []);

  const ficha = loaded && loaded.employeeId === employeeId ? loaded.ficha : null;
  const documents = docs && docs.employeeId === employeeId ? docs.items : null;

  // ---- ações (uma por vez; guarda por ref além de aria-disabled)
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const empRef = useRef(employeeId);
  empRef.current = employeeId;
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verify, setVerify] = useState<Record<string, FichaVerify>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [link, setLink] = useState<{ employeeId: string; deliveryId: string } | null>(null);
  const [person, setPerson] = useState<{ employeeId: string; deliveryId: string } | null>(null);
  const [linksTick, setLinksTick] = useState(0);
  const keyRef = useRef<string | null>(null);

  // Outro funcionário ou outros filtros = outra emissão: a chave de idempotência recomeça. Só o reenvio do MESMO formulário a reaproveita.
  useEffect(() => { keyRef.current = null; }, [employeeId, from, to, status]);
  useEffect(() => { setVerify({}); setActionError(null); setNotice(null); setConfirmOpen(false); setLink(null); setPerson(null); }, [employeeId]);

  async function act(key: string, ctx: FichaCtx, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setActionError(null);
    setNotice(null);
    const emp = employeeId;
    try {
      await fn();
    } catch (e) {
      if (empRef.current === emp) setActionError(mapFichaError(e, ctx));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const blocked = busy !== null;
  const afterOpen = (r: 'opened' | 'downloaded') => {
    if (r === 'downloaded') setNotice('O navegador não abriu a nova aba; o arquivo foi baixado.');
  };

  function preview() {
    if (busyRef.current) return;
    const win = openBlankWindow(); // no clique: depois de um await o navegador bloquearia a aba
    void act('previa', 'previa', async () => {
      afterOpen(await openOrDownload(epiPaths.fichaPreview(employeeId, query), { mode: 'open', win, filename: 'ficha-epi-previa.pdf' }));
    });
  }

  function emit() {
    keyRef.current ??= newIdempotencyKey();
    const idempotency_key = keyRef.current;
    const emp = employeeId;
    void act('emitir', 'emitir', async () => {
      try {
        const doc = await epiApi.fichaIssue(emp, { idempotency_key, ...query });
        keyRef.current = null;
        if (empRef.current === emp) {
          setNotice(`Ficha emitida: documento ${doc.document_code}, versão ${doc.version}.`);
          setDocsTick((n) => n + 1);
        }
      } catch (e) {
        // 409: a chave já pertence a outra operação; repetir exige chave nova.
        if (e instanceof EpiApiError && e.status === 409) keyRef.current = null;
        throw e;
      } finally {
        setConfirmOpen(false);
      }
    });
  }

  function download(d: FichaDocument) {
    void act(`baixar:${d.id}`, 'baixar', async () => {
      afterOpen(await openOrDownload(epiPaths.fichaDownload(d.id), { mode: 'download', filename: `${d.document_code}.pdf` }));
    });
  }

  function check(d: FichaDocument) {
    const emp = employeeId;
    void act(`verificar:${d.id}`, 'verificar', async () => {
      const r = await epiApi.fichaVerify(d.id);
      if (empRef.current === emp) setVerify((v) => ({ ...v, [d.id]: r }));
    });
  }

  function receipt(l: FichaLine) {
    if (busyRef.current) return;
    const win = openBlankWindow();
    void act(`comprovante:${l.signature_id}`, 'comprovante', async () => {
      afterOpen(await openOrDownload(epiPaths.receipt(l.signature_id as string), { mode: 'open', win, filename: `${l.receipt_code ?? 'comprovante'}.pdf` }));
    });
  }

  const aria = (extra?: boolean) => blocked || extra === true;
  const canAct = employeeId !== '' && !periodInvalid && ficha !== null && !loading;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Funcionário e filtros">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="ficha-busca" className={LABEL}>Buscar funcionário por nome</label>
            <input id="ficha-busca" type="search" className={FIELD} value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="ficha-emp" className={LABEL}>Funcionário</label>
            <select id="ficha-emp" className={FIELD} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Selecione o funcionário</option>
              {options.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <p aria-live="polite" className="mt-1 text-base text-dash-muted">
              {search.trim() ? (options.length === 0 ? 'Nenhum funcionário encontrado.' : `${options.length} funcionário(s) encontrado(s).`) : ''}
            </p>
          </div>
          <div>
            <label htmlFor="ficha-status" className={LABEL}>Situação da assinatura</label>
            <select id="ficha-status" className={FIELD} value={status} onChange={(e) => setStatus(e.target.value as SignatureStatus | '')}>
              <option value="">Todas</option>
              {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ficha-de" className={LABEL}>De</label>
            <input id="ficha-de" type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={periodInvalid ? true : undefined} />
          </div>
          <div>
            <label htmlFor="ficha-ate" className={LABEL}>Até</label>
            <input id="ficha-ate" type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={periodInvalid ? true : undefined} />
          </div>
        </div>
        {periodInvalid && <p role="alert" className="mt-3 text-base text-dash-status-crit-text">A data inicial não pode ser depois da data final.</p>}
        {empError && (
          <div role="alert" className="mt-3 flex flex-col items-start gap-2 text-base text-dash-status-crit-text">
            <span>{empError}</span>
            <button type="button" className={BTN_SECONDARY} onClick={() => setEmpTry((n) => n + 1)}>Tentar novamente</button>
          </div>
        )}
      </Card>

      <div aria-live="polite" role="status" className="empty:hidden">
        {notice && <p className="rounded-lg bg-dash-status-ok-bg p-3 text-base text-dash-status-ok-text">{notice}</p>}
      </div>
      {actionError && <p role="alert" className="rounded-lg bg-dash-status-crit-bg p-3 text-base text-dash-status-crit-text">{actionError}</p>}

      {!employeeId && <p className="text-base text-dash-muted">Escolha um funcionário para ver a ficha de EPI.</p>}

      {employeeId && loading && !ficha && (
        <div role="status" aria-label="Carregando ficha" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {employeeId && error && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[18px] bg-dash-card p-6 text-base text-dash-status-crit-text">
          <span>{error}</span>
          <button type="button" className={BTN_SECONDARY} onClick={() => setReload((n) => n + 1)}>Tentar novamente</button>
        </div>
      )}

      {ficha && !error && (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <Card title="Dados da ficha">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-base text-dash-primary sm:grid-cols-2">
              <div><dt className="text-dash-muted">Empresa</dt><dd>{ficha.company.trade_name || ficha.company.name}</dd></div>
              <div><dt className="text-dash-muted">CNPJ</dt><dd>{formatCnpj(ficha.company.cnpj)}</dd></div>
              <div><dt className="text-dash-muted">Funcionário</dt><dd>{ficha.employee.full_name}</dd></div>
              <div><dt className="text-dash-muted">CPF</dt><dd>{ficha.employee.cpf_masked}</dd></div>
              <div><dt className="text-dash-muted">Matrícula</dt><dd>{orNot(ficha.employee.registration_number)}</dd></div>
              <div><dt className="text-dash-muted">Setor</dt><dd>{orNot(ficha.employee.department)}</dd></div>
              <div><dt className="text-dash-muted">Função</dt><dd>{orNot(ficha.employee.position)}</dd></div>
            </dl>
          </Card>

          {ficha.term.draft && (
            <p role="note" className="mt-4 rounded-lg bg-dash-status-warn-bg p-3 text-base text-dash-status-warn-text">
              O termo de recebimento (versão {ficha.term.version}) ainda está em rascunho, pendente de revisão. O documento emitido agora carrega o termo em rascunho.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={BTN_SECONDARY} aria-disabled={aria(!canAct)} onClick={() => { if (!aria(!canAct)) preview(); }}>
              {busy === 'previa' ? 'Abrindo...' : 'Pré-visualizar PDF'}
            </button>
            <button type="button" className={BTN_PRIMARY} aria-disabled={aria(!canAct)} onClick={() => { if (!aria(!canAct)) setConfirmOpen(true); }}>
              Emitir ficha
            </button>
          </div>

          <div className="mt-4">
            <Card title="Histórico de EPI">
              {ficha.lines.length === 0 ? (
                <p className="text-base text-dash-muted">Nenhum registro para os filtros escolhidos.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-base text-dash-primary">
                    <caption className="sr-only">Histórico de EPI do funcionário</caption>
                    <thead>
                      <tr className="border-b border-dash-border-soft text-dash-muted">
                        <th scope="col" className="py-2 pr-3 font-medium">Data</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Tipo</th>
                        <th scope="col" className="py-2 pr-3 font-medium">EPI</th>
                        <th scope="col" className="py-2 pr-3 font-medium">CA</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Qtd.</th>
                        <th scope="col" className="py-2 font-medium">Assinatura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.lines.map((l, i) => {
                        const waiting = l.delivery_id && !l.reversed && (l.signature_status === 'pendente' || l.signature_status === 'recusada');
                        return (
                          <tr key={`${l.movement_id ?? l.delivery_id ?? 'l'}-${i}`} className="border-b border-dash-border-soft align-top">
                            <td className="py-2 pr-3">{formatDate(l.date)}</td>
                            <td className="py-2 pr-3">{LINE_TYPE[l.type]}</td>
                            <td className="py-2 pr-3">
                              {l.epi_description}
                              {(l.manufacturer || l.model) && <span className="block text-dash-muted">{[l.manufacturer, l.model].filter(Boolean).join(' · ')}</span>}
                              {l.reason && <span className="block text-dash-muted">Motivo: {l.reason}</span>}
                            </td>
                            <td className="py-2 pr-3">{l.ca_number}</td>
                            <td className="py-2 pr-3">{formatQty(l.quantity)}</td>
                            <td className="py-2">
                              <div className="flex flex-col items-start gap-1">
                                {l.reversed ? <Badge tone="crit" large>Estornada</Badge> : l.signature_status ? <SignatureStatusBadge status={l.signature_status} /> : <span className="text-dash-muted">Não se aplica</span>}
                                {l.receipt_code && (
                                  <span className="text-dash-muted">Comprovante {l.receipt_code}{l.signed_at ? ` · ${formatDateTime(l.signed_at)}` : ''}</span>
                                )}
                                {l.receipt_code && l.signature_id && (
                                  <button type="button" className={BTN_SECONDARY} aria-disabled={aria()} onClick={() => { if (!aria()) receipt(l); }}>
                                    {busy === `comprovante:${l.signature_id}` ? 'Abrindo...' : `Baixar comprovante ${l.receipt_code}`}
                                  </button>
                                )}
                                {waiting && (
                                  <button type="button" className={BTN_SECONDARY} aria-disabled={aria()} onClick={() => { if (!aria()) setLink({ employeeId, deliveryId: l.delivery_id as string }); }}>
                                    Gerar link
                                  </button>
                                )}
                                {waiting && (
                                  <button type="button" className={BTN_SECONDARY} aria-disabled={aria()} onClick={() => { if (!aria()) setPerson({ employeeId, deliveryId: l.delivery_id as string }); }}>
                                    Registrar assinatura presencial
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {employeeId && (
        <Card title="Links de assinatura ativos">
          <ActiveLinks key={employeeId} employeeId={employeeId} tenantKey={tenantId ?? ''} refreshKey={linksTick} />
        </Card>
      )}

      {employeeId && (
        <Card title="Versões emitidas">
          {docsError && (
            <div role="alert" className="flex flex-col items-start gap-2 text-base text-dash-status-crit-text">
              <span>{docsError}</span>
              <button type="button" className={BTN_SECONDARY} onClick={() => setDocsTick((n) => n + 1)}>Tentar novamente</button>
            </div>
          )}
          {!docsError && !documents && <Skeleton className="h-16 w-full" />}
          {documents && documents.length === 0 && <p className="text-base text-dash-muted">Nenhuma ficha emitida para este funcionário.</p>}
          {documents && documents.length > 0 && (
            <ul className="flex flex-col gap-4">
              {documents.map((d) => {
                const v = verify[d.id];
                const vv = v ? VERIFY_VIEW[v.status] : null;
                return (
                  <li key={d.id} className="border-b border-dash-border-soft pb-4 last:border-b-0 last:pb-0">
                    <p className="text-base font-semibold text-dash-primary">{d.document_code} · versão {d.version}</p>
                    <p className="text-base text-dash-muted">Emitida em {formatDateTime(d.issued_at)} · termo {d.term_version}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <button type="button" className={BTN_SECONDARY} aria-disabled={aria()} onClick={() => { if (!aria()) download(d); }}>
                        {busy === `baixar:${d.id}` ? 'Baixando...' : `Baixar versão ${d.version}`}
                      </button>
                      <button type="button" className={BTN_SECONDARY} aria-disabled={aria()} onClick={() => { if (!aria()) check(d); }}>
                        {busy === `verificar:${d.id}` ? 'Verificando...' : `Verificar integridade da versão ${d.version}`}
                      </button>
                    </div>
                    {vv && (
                      <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-base text-dash-primary">
                        <Badge tone={vv.tone} large>{vv.label}</Badge>
                        <span>{vv.text}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Emitir ficha de EPI"
        description="Isto grava uma nova versão do documento, que não pode ser alterada nem apagada depois."
        confirmLabel="Emitir ficha"
        busy={busy === 'emitir'}
        onConfirm={emit}
        onCancel={() => setConfirmOpen(false)}
      >
        {ficha?.term.draft && (
          <p className="text-base text-dash-status-warn-text">Atenção: o termo de recebimento ainda está em rascunho e será gravado assim no documento.</p>
        )}
      </ConfirmDialog>

      <SignatureLinkDialog
        open={link !== null && link.employeeId === employeeId}
        tenantId={tenantId}
        employeeId={link?.employeeId ?? ''}
        deliveryIds={link ? [link.deliveryId] : undefined}
        onClose={(changed) => { setLink(null); if (changed) { setReload((n) => n + 1); setLinksTick((n) => n + 1); } }}
      />
      <InPersonDialog
        open={person !== null && person.employeeId === employeeId}
        deliveryIds={person ? [person.deliveryId] : []}
        onClose={() => setPerson(null)}
        onDone={() => { setReload((n) => n + 1); setLinksTick((n) => n + 1); setNotice('Assinatura presencial registrada.'); }}
      />
    </div>
  );
}
