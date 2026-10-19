'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_NOTICE, AI_PARTIAL_NOTICE, FIELD_LABELS, statusMessage, UNEXPECTED_RESPONSE, asList, isTextMethod, reasonLabel, safeText, type Extraction, type ExtractionItem, type FieldConflict, type FieldSuggestion } from '@/lib/employees-ingestion';
import { formatHistoryValue } from '@/lib/employees-history';
import { sessionExpired } from '@/lib/auth';

type Decision = { line: number; action: 'aplicar' | 'ignorar'; fields?: string[] };

// Alvos de toque com 44px de altura mínima e texto de 16px; checkbox maior e rótulo com a mesma altura.
const btn =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-primary disabled:cursor-not-allowed disabled:opacity-50';
const checkCls = 'mt-2.5 h-6 w-6 shrink-0 accent-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-primary';

// Texto vindo do documento: sem caracteres de direção/invisíveis e isolado (bdi) para não embaralhar o entorno.
const B = ({ v }: { v: unknown }) => <span dir="auto">{safeText(v)}</span>;
// Vazio aparece escrito, não como traço solto.
const shown = (field: string, v: string | null | undefined) => (v == null || v === '' ? '(vazio)' : safeText(formatHistoryValue(field, v)));

const novoFields = (i: ExtractionItem) =>
  asList<{ field: string; value: string }>(i.fields).filter((f) => f && typeof f.field === 'string' && typeof f.value === 'string' && f.value !== '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const da = (origem: string) => (origem === 'documento' ? 'do documento' : 'da planilha');

function errorMessage(status: number, data: unknown, origem: string): string {
  const msg = typeof (data as { message?: unknown })?.message === 'string' ? ((data as { message: string }).message) : '';
  // 403 com motivo próprio (ex.: limite de funcionários do plano) mostra o motivo; o 403 genérico do guard
  // ("Forbidden resource", em inglês) ou sem corpo cai no texto padrão.
  if (status === 403) return msg && msg !== 'Forbidden resource' ? msg : 'Você não tem permissão para resolver esta revisão.';
  if (status === 409) {
    const base = msg || 'Esta revisão não pode mais ser resolvida.';
    return /reenvie/i.test(base) ? base : `${base} Reenvie ${origem === 'documento' ? 'o documento' : 'a planilha'}.`;
  }
  if (status === 400) return msg || 'Revise as marcações e tente novamente.';
  return 'Não foi possível salvar as decisões. Tente novamente.';
}

export function RevisaoExtracaoPanel({
  extraction,
  onResolved,
  onCancel,
}: {
  extraction: Extraction;
  onResolved: (e: Extraction) => void;
  onCancel: () => void;
}) {
  const itemsOk = Array.isArray(extraction?.items);
  const all = useMemo(() => asList<ExtractionItem>(extraction?.items), [extraction?.items]);
  const novos = useMemo(() => all.filter((i) => i.kind === 'novo'), [all]);
  const conflitos = useMemo(() => all.filter((i) => i.kind === 'conflito'), [all]);
  const sugestoes = useMemo(() => all.filter((i) => i.kind === 'sugestao'), [all]);
  const invalidas = useMemo(() => all.filter((i) => i.kind === 'invalida'), [all]);
  const pendentes = [...novos, ...conflitos, ...sugestoes];
  // Planilha mantém os textos da Fatia 3; PDF/DOCX falam em "documento".
  const origem = isTextMethod(extraction?.summary ?? {}) ? 'documento' : 'planilha';
  const aiUsed = extraction?.summary?.ai_used === true;

  // Tudo começa desmarcado: nada é aplicado sem decisão explícita.
  // Conflito e sugestão: "aplicar" é derivado dos campos marcados (nenhum campo = ignorar).
  const [chosen, setChosen] = useState<Record<number, { aplicar: boolean; fields: string[] }>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(itemsOk ? '' : UNEXPECTED_RESPONSE);
  const [result, setResult] = useState('');
  const sendingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const marcados = pendentes.filter((i) => {
    const c = chosen[i.line];
    return c && (i.kind === 'novo' ? c.aplicar : c.fields.length > 0);
  }).length;

  function toggleNovo(line: number, on: boolean) {
    setChosen((p) => ({ ...p, [line]: { aplicar: on, fields: [] } }));
  }
  function toggleField(line: number, field: string, on: boolean) {
    setChosen((p) => {
      const cur = p[line]?.fields ?? [];
      const fields = on ? [...cur.filter((f) => f !== field), field] : cur.filter((f) => f !== field);
      return { ...p, [line]: { aplicar: fields.length > 0, fields } };
    });
  }

  async function send(decisions: Decision[]) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch(`/api/employees/extractions/${extraction.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decisions }),
      });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorMessage(res.status, data, origem));
        return;
      }
      const e = data as Extraction;
      if (!Array.isArray(e?.items) || !e?.status) {
        setError('As decisões podem ter sido salvas. Atualize a página para conferir.');
        return;
      }
      const r = e.summary?.resolved;
      setResult(`${r?.aplicados ?? 0} aplicados, ${r?.ignorados ?? 0} ignorados.`);
      onResolved(e);
      // O botão de confirmar some: o foco volta ao título.
      setTimeout(() => headingRef.current?.focus(), 0);
    } catch {
      setError('Não foi possível salvar as decisões. Verifique a conexão e tente novamente.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function confirmar() {
    // Nada marcado: confirmar ignoraria tudo. Pede confirmação explícita em vez de seguir em silêncio.
    if (
      pendentes.length > 0 &&
      marcados === 0 &&
      !window.confirm(
        `Nenhum item está marcado para aplicar. Confirmar vai ignorar ${plural(pendentes.length, 'item', 'itens')} e nada entrará no cadastro. Continuar?`,
      )
    ) {
      return;
    }
    send(
      pendentes.map((i): Decision => {
        const c = chosen[i.line];
        if (i.kind === 'novo') return { line: i.line, action: c?.aplicar ? 'aplicar' : 'ignorar' };
        // outra_filial não tem conflicts e só aceita ignorar.
        if (i.reason === 'outra_filial' || !c || c.fields.length === 0) return { line: i.line, action: 'ignorar' };
        // Mantém a ordem dos campos: diferenças primeiro, depois sugestões.
        const fields = [...asList<FieldConflict>(i.conflicts).map((x) => x.field), ...asList<FieldSuggestion>(i.suggestions).map((x) => x.field)].filter((f) => c.fields.includes(f));
        return { line: i.line, action: 'aplicar', fields };
      }),
    );
  }

  function descartar() {
    if (!window.confirm(`Descartar todos os itens ${origem === 'documento' ? 'deste documento' : 'desta planilha'}? Nada será alterado no cadastro.`)) return;
    send(pendentes.map((i): Decision => ({ line: i.line, action: 'ignorar' })));
  }

  // Revisão expirada: sem decisões possíveis; só a mensagem e o botão de fechar.
  if (extraction?.status === 'expirado') {
    return (
      <section role="region" aria-label="Revisão expirada" className="flex flex-col gap-4 rounded-lg border border-dash-border-soft p-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-dash-primary focus:outline-none">
          Revisão expirada
        </h2>
        <p role="alert" className="rounded-md bg-dash-status-warn-bg px-3 py-2 text-sm text-dash-status-warn-text">
          {statusMessage(extraction)}
        </p>
        <div>
          <button type="button" onClick={onCancel} className={`${btn} border border-dash-border-soft text-dash-primary`}>
            Fechar
          </button>
        </div>
      </section>
    );
  }

  const done = result !== '';
  const statusText = sending
    ? 'Enviando decisões...'
    : done
      ? result
      : `${pendentes.length} ${pendentes.length === 1 ? 'item' : 'itens'} para decidir, ${marcados} ${marcados === 1 ? 'marcado' : 'marcados'} para aplicar.`;

  return (
    <section role="region" aria-label={origem === 'documento' ? 'Revisão do documento enviado' : 'Revisão da planilha enviada'} className="flex flex-col gap-4 rounded-lg border border-dash-border-soft p-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-dash-primary focus:outline-none">
        {origem === 'documento' ? 'Revisão do documento enviado' : 'Revisão da planilha enviada'}
      </h2>
      {!done && (
        <p className="text-sm text-dash-muted">
          Nada foi alterado nestes itens. Marque o que deve entrar no cadastro; o que ficar desmarcado será ignorado.
        </p>
      )}
      {aiUsed && (
        <p className="rounded-md bg-dash-status-warn-bg px-3 py-2 text-sm text-dash-status-warn-text">
          {AI_NOTICE}
          {extraction?.summary?.ai_partial ? ` ${AI_PARTIAL_NOTICE}` : ''}
        </p>
      )}
      {/* Região viva sempre montada: o texto muda depois, para os leitores de tela anunciarem. */}
      <div
        role="status"
        aria-live="polite"
        className={`text-sm font-semibold ${done ? 'text-dash-status-ok-text' : 'text-dash-muted'}`}
      >
        {statusText}
      </div>
      <div
        role="alert"
        className={error ? 'rounded-md bg-dash-status-crit-bg px-3 py-2 text-sm text-dash-status-crit-text' : undefined}
      >
        {error}
      </div>

      {!done && (
        <>
          {novos.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-dash-primary">Novos funcionários</h3>
              <ul className="flex flex-col gap-2">
                {novos.map((i) => (
                  <li key={i.line} className="rounded-md border border-dash-border-soft p-3">
                    <label className="flex min-h-11 items-start gap-2 text-base text-dash-primary">
                      <input
                        type="checkbox"
                        aria-label={`Cadastrar ${safeText(i.full_name)}${novoFields(i).length > 0 ? ` com ${plural(novoFields(i).length, 'campo', 'campos')}` : ''}, linha ${i.line}`}
                        className={checkCls}
                        checked={chosen[i.line]?.aplicar ?? false}
                        disabled={sending}
                        onChange={(e) => toggleNovo(i.line, e.target.checked)}
                      />
                      <span className="min-w-0 break-words">
                        Cadastrar <span className="font-semibold"><B v={i.full_name} /></span>
                        <span className="ml-2 text-dash-muted">{i.cpf_masked}</span>
                      </span>
                    </label>
                    <p className="ml-8 text-xs text-dash-muted">Linha {i.line} {da(origem)}</p>
                    <NovoFields item={i} />
                    <Evidence item={i} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflitos.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-dash-primary">Diferenças com o cadastro</h3>
              <ul className="flex flex-col gap-2">
                {conflitos.map((i) => (
                  <ConflictItem key={i.line} item={i} origem={origem} chosen={chosen[i.line]?.fields ?? []} disabled={sending} onToggle={toggleField} />
                ))}
              </ul>
            </div>
          )}

          {sugestoes.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-dash-primary">Sugestões de preenchimento</h3>
              <p className="text-xs text-dash-muted">Campos hoje vazios no cadastro. Nada é preenchido sem a sua marcação.</p>
              <ul className="flex flex-col gap-2">
                {sugestoes.map((i) => (
                  <ConflictItem key={i.line} item={i} origem={origem} chosen={chosen[i.line]?.fields ?? []} disabled={sending} onToggle={toggleField} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {invalidas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-dash-primary">Linhas com problema</h3>
          <p className="text-xs text-dash-muted">Estas linhas não foram aplicadas. Corrija o arquivo e envie de novo.</p>
          <ul className="flex flex-col gap-1">
            {invalidas.map((i) => (
              <li key={i.line} className="text-sm text-dash-primary">
                <span className="font-semibold">Linha {i.line}</span>
                <span className="text-dash-muted">: <B v={reasonLabel(i.reason)} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!done && (
          <>
            <button type="button" onClick={confirmar} disabled={sending} className={`${btn} bg-dash-primary text-white`}>
              Confirmar decisões
            </button>
            <button type="button" onClick={descartar} disabled={sending} className={`${btn} border border-dash-border-soft text-dash-primary`}>
              Descartar tudo
            </button>
          </>
        )}
        <button type="button" onClick={onCancel} disabled={sending} className={`${btn} border border-dash-border-soft text-dash-primary`}>
          {done ? 'Fechar' : 'Decidir depois'}
        </button>
      </div>
    </section>
  );
}

/** Dados não-CPF que serão gravados se o novo funcionário for aprovado (texto puro, sem HTML). */
function NovoFields({ item }: { item: ExtractionItem }) {
  const fields = novoFields(item);
  const id = `novo-fields-${item.line}`;
  return (
    <div className="ml-8 mt-2">
      <p id={id} className="text-xs font-semibold text-dash-muted">
        Dados que serão cadastrados
      </p>
      {fields.length === 0 ? (
        <p className="text-xs text-dash-muted">Somente nome e CPF serão cadastrados.</p>
      ) : (
        <dl aria-labelledby={id} className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {fields.map((f) => (
            <div key={f.field} className="contents">
              <dt className="text-dash-muted">{FIELD_LABELS[f.field] ?? f.field}</dt>
              <dd dir="auto" className="min-w-0 break-words font-semibold text-dash-primary">
                {safeText(formatHistoryValue(f.field, f.value))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Trecho do documento (já mascarado pelo backend): texto puro, em elemento próprio, nomeado para leitores de tela. */
function Evidence({ item }: { item: ExtractionItem }) {
  if (!item.evidence) return null;
  const id = `evid-${item.line}`;
  return (
    <div className="mt-2">
      <p id={id} className="text-xs font-semibold text-dash-muted">
        Trecho do documento
      </p>
      <blockquote
        aria-labelledby={id}
        dir="auto"
        className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border-l-2 border-dash-border-soft bg-dash-card px-3 py-2 text-xs text-dash-primary"
      >
        {safeText(item.evidence)}
      </blockquote>
    </div>
  );
}

function ConflictItem({
  item,
  origem,
  chosen,
  disabled,
  onToggle,
}: {
  item: ExtractionItem;
  origem: string;
  chosen: string[];
  disabled: boolean;
  onToggle: (line: number, field: string, on: boolean) => void;
}) {
  const outraFilial = item.reason === 'outra_filial';
  const conflicts = asList<FieldConflict>(item.conflicts);
  const suggestions = asList<FieldSuggestion>(item.suggestions);
  const who = safeText(item.full_name);
  const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;
  return (
    <li className="rounded-md border border-dash-border-soft p-3">
      <p className="break-words text-sm text-dash-primary">
        <span className="font-semibold"><B v={item.full_name} /></span>
        <span className="ml-2 text-dash-muted">{item.cpf_masked}</span>
        <span className="block text-xs text-dash-muted">Linha {item.line} {da(origem)}</span>
      </p>
      {outraFilial ? (
        <p className="mt-2 rounded-md bg-dash-status-warn-bg px-3 py-2 text-sm text-dash-status-warn-text">
          <B v={reasonLabel(item.reason)} />. Nada será alterado: este funcionário não é transferido de filial.
        </p>
      ) : (
        <>
          {conflicts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {conflicts.map((c) => {
                const id = `conf-${item.line}-${c.field}`;
                return (
                  <li key={c.field} className="flex items-start gap-2">
                    <input
                      id={`${id}-cb`}
                      type="checkbox"
                      className={checkCls}
                      checked={chosen.includes(c.field)}
                      disabled={disabled}
                      aria-label={`Usar o valor ${da(origem)}: ${fieldLabel(c.field)} de ${who}, atual ${shown(c.field, c.current)}, ${origem} ${shown(c.field, c.proposed)}`}
                      onChange={(e) => onToggle(item.line, c.field, e.target.checked)}
                    />
                    <div className="min-w-0 text-sm">
                      <label htmlFor={`${id}-cb`} className="inline-flex min-h-11 items-center text-base font-semibold text-dash-primary">
                        Usar o valor {da(origem)}
                      </label>
                      <p id={id} className="break-words text-dash-primary">
                        <span className="text-dash-muted">{FIELD_LABELS[c.field] ?? c.field}: </span>
                        <span className="sr-only">atual </span>
                        <span className="text-dash-muted"><B v={shown(c.field, c.current)} /></span>
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only"> {origem} </span>
                        <span className="font-semibold"><B v={shown(c.field, c.proposed)} /></span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {suggestions.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2" aria-label={`Sugestões de preenchimento da linha ${item.line}`}>
              {suggestions.map((sg) => {
                const id = `sug-${item.line}-${sg.field}`;
                return (
                  <li key={sg.field} className="flex items-start gap-2">
                    <input
                      id={`${id}-cb`}
                      type="checkbox"
                      className={checkCls}
                      checked={chosen.includes(sg.field)}
                      disabled={disabled}
                      aria-label={`Preencher campo vazio: ${fieldLabel(sg.field)} de ${who}, atual vazio, sugerido ${shown(sg.field, sg.proposed)}`}
                      onChange={(e) => onToggle(item.line, sg.field, e.target.checked)}
                    />
                    <div className="min-w-0 text-sm">
                      <label htmlFor={`${id}-cb`} className="inline-flex min-h-11 items-center text-base font-semibold text-dash-primary">
                        Preencher campo vazio
                      </label>
                      <p id={id} className="break-words text-dash-primary">
                        <span className="text-dash-muted">{FIELD_LABELS[sg.field] ?? sg.field}: </span>
                        <span className="sr-only">atual </span>
                        <span className="text-dash-muted">(vazio)</span>
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only">sugerido </span>
                        <span className="font-semibold"><B v={shown(sg.field, sg.proposed)} /></span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <Evidence item={item} />
    </li>
  );
}
