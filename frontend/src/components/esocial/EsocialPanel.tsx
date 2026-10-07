'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ApiError, STATUS_LABEL, api } from './esocial-api';
import { Field, btn2Cls, btnCls, fmt, inputCls } from './ui';

interface Employee { id: string; full_name: string }
interface Aso { id: string; exam_type: string; exam_date: string; result: string }
interface Cert { id: string; label: string; notAfter: string; status: string; subjectCn: string }
interface Issue { code: string; message: string; blocking: boolean }
interface EvRow { id: string; event_type: string; target_event_id: string | null; status: string; employee_name: string; protocolo_lote: string | null; nr_recibo: string | null; erro_codigo: string | null; erro_mensagem: string | null; created_at: string }

const EXAM_TYPES = [
  ['admissional', 'Admissional'], ['periodico', 'Periódico'], ['retorno_trabalho', 'Retorno ao trabalho'],
  ['mudanca_funcao', 'Mudança de função'], ['monitoracao_pontual', 'Monitoração pontual'], ['demissional', 'Demissional'],
] as const;
export function EsocialPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [events, setEvents] = useState<EvRow[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [asos, setAsos] = useState<Aso[]>([]);
  const [asoId, setAsoId] = useState('');
  const [certId, setCertId] = useState('');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [physicians, setPhysicians] = useState<Array<{ id: string; name: string }>>([]);

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ tipo: 'ok', texto: ok }); }
    catch (e) {
      const err = e as ApiError;
      if (err.issues) setIssues(err.issues);
      setMsg({ tipo: 'erro', texto: err.message });
    } finally { setBusy(false); }
  }, []);

  const loadBase = useCallback(async () => {
    try {
      const [c, e, ev, p] = await Promise.all([api<Cert[]>('/esocial/certificates'), api<Employee[]>('/employees'), api<EvRow[]>('/esocial/events'), api<any[]>('/aso/pcmso-physicians')]);
      setCerts(c.filter((x) => x.status === 'ativo')); setEmployees(e); setEvents(ev); setPhysicians(p);
      setCertId((cur) => cur || c.find((x) => x.status === 'ativo')?.id || '');
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }, []);
  useEffect(() => { loadBase(); }, [loadBase, refreshKey]);

  useEffect(() => {
    setAsos([]); setAsoId(''); setIssues(null);
    if (employeeId) api<Aso[]>(`/aso/records?employeeId=${employeeId}`).then(setAsos).catch((e) => setMsg({ tipo: 'erro', texto: e.message }));
  }, [employeeId]);

  const verificar = () => run(async () => {
    const q = `asoRecordId=${asoId}${certId ? `&certificateId=${certId}` : ''}`;
    setIssues((await api<{ issues: Issue[] }>(`/esocial/events/diagnostics?${q}`)).issues);
  });
  const refreshAsos = async () => setAsos(await api<Aso[]>(`/aso/records?employeeId=${employeeId}`));

  const uploadCert = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form);
    run(async () => { await api('/esocial/certificates', { method: 'POST', body: fd }); form.reset(); await loadBase(); }, 'Certificado enviado e guardado cifrado.');
  };
  const criarAso = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    run(async () => {
      const created = await api<Aso>('/aso/records', { method: 'POST', json: {
        employeeId, examType: f.get('examType'), examDate: f.get('examDate'), result: f.get('result'),
        resultDisclosureAuthorized: false, doctorName: f.get('doctorName'), doctorCrm: f.get('doctorCrm'),
        doctorCrmUf: String(f.get('doctorCrmUf')).toUpperCase(), ...(f.get('physician') ? { pcmsoPhysicianId: f.get('physician') } : {}),
      } });
      await refreshAsos(); setAsoId(created.id); form.reset();
    }, 'ASO cadastrado.');
  };
  const addExame = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    run(async () => {
      await api(`/aso/records/${asoId}/exams`, { method: 'POST', json: {
        procedureCode: f.get('procedureCode'), procedureName: f.get('procedureName'), examDate: f.get('examDate'),
        ...(f.get('orderExam') ? { orderExam: Number(f.get('orderExam')) } : {}),
        ...(f.get('obsProc') ? { obsProc: f.get('obsProc') } : {}),
      } });
      form.reset();
    }, 'Exame adicionado ao ASO.');
  };
  const salvarVinculo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const json: Record<string, string> = {};
    if (f.get('registrationNumber')) json.registrationNumber = String(f.get('registrationNumber'));
    if (f.get('esocialCategoryCode')) json.esocialCategoryCode = String(f.get('esocialCategoryCode'));
    run(() => api(`/esocial/employees/${employeeId}/prerequisites`, { method: 'PATCH', json }), 'Dados do vínculo salvos.');
  };
  const confirmarVinculo = () => {
    if (!window.confirm('Confirma que o vínculo deste trabalhador JÁ foi enviado ao eSocial (S-2200, S-2190 ou S-2300) por quem faz a folha?')) return;
    run(() => api(`/esocial/employees/${employeeId}/confirm-vinculo`, { method: 'POST' }), 'Vínculo confirmado.');
  };
  const novoMedico = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    run(async () => { await api('/aso/pcmso-physicians', { method: 'POST', json: { cpf: String(f.get('cpf')).replace(/\D/g, ''), name: f.get('name'), crm: f.get('crm'), crmUf: String(f.get('crmUf')).toUpperCase() } }); form.reset(); await loadBase(); }, 'Médico coordenador cadastrado.');
  };
  const gerar = () => run(async () => { await api('/esocial/events', { method: 'POST', json: { asoRecordId: asoId, certificateId: certId } }); setIssues(null); await loadBase(); }, 'Rascunho gerado. O XML foi validado no XSD oficial. Nada foi enviado.');

  const acao = (id: string, a: 'authorize' | 'transmit' | 'consult' | 'exclusion') => {
    const aviso = {
      authorize: 'Autorizar este evento? Você será registrado como quem autorizou. Ainda não será enviado.',
      transmit: 'Assinar com o certificado digital e TRANSMITIR ao eSocial em PRODUÇÃO RESTRITA (ambiente de testes)? Esta ação usa o certificado da empresa e é registrada no histórico.',
      consult: '',
      exclusion: 'Criar o rascunho de EXCLUSÃO (S-3000) deste evento? O evento original só deixa de valer quando o eSocial processar a exclusão. Nada é enviado agora: você ainda precisará autorizar e transmitir.',
    }[a];
    if (aviso && !window.confirm(aviso)) return;
    run(async () => { await api(`/esocial/events/${id}/${a}`, { method: 'POST' }); await loadBase(); }, a === 'consult' ? 'Consulta feita.' : a === 'authorize' ? 'Evento autorizado.' : a === 'exclusion' ? 'Rascunho de exclusão (S-3000) criado. Autorize e transmita para concluir.' : 'Transmissão concluída; consulte o resultado.');
  };

  return (
    <div className="space-y-6">
      <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Ambiente de <strong>Produção Restrita</strong> do eSocial (testes, sem efeito legal). Nada é assinado ou enviado sem a sua autorização.
      </div>
      <div aria-live="polite">
        {msg && <p role={msg.tipo === 'erro' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ${msg.tipo === 'erro' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{msg.texto}</p>}
      </div>

      <Card title="1. Certificado digital A1">
        {certs.length === 0 ? <p className="mb-3 text-sm text-dash-muted">Nenhum certificado ativo.</p> : (
          <ul className="mb-4 space-y-1 text-sm">
            {certs.map((c) => <li key={c.id}>{c.label}, {c.subjectCn}, válido até {fmt(c.notAfter)}</li>)}
          </ul>
        )}
        <form onSubmit={uploadCert} className="grid gap-3 sm:grid-cols-3">
          <Field label="Nome do certificado"><input name="label" required className={inputCls} /></Field>
          <Field label="Senha do certificado"><input name="password" type="password" required autoComplete="off" className={inputCls} /></Field>
          <Field label="Arquivo .pfx / .p12"><input name="file" type="file" accept=".pfx,.p12" required className={inputCls} /></Field>
          <div className="sm:col-span-3"><button disabled={busy} className={btnCls}>Enviar certificado</button></div>
        </form>
      </Card>

      <Card title="2. ASO e pendências do S-2220">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Funcionário">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
              <option value="">Selecione</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </Field>
          <Field label="ASO">
            <select value={asoId} onChange={(e) => { setAsoId(e.target.value); setIssues(null); }} disabled={!employeeId} className={inputCls}>
              <option value="">{employeeId ? (asos.length ? 'Selecione' : 'Nenhum ASO') : 'Escolha o funcionário'}</option>
              {asos.map((a) => <option key={a.id} value={a.id}>{fmt(a.exam_date)}, {a.exam_type}, {a.result}</option>)}
            </select>
          </Field>
          <Field label="Certificado a usar">
            <select value={certId} onChange={(e) => setCertId(e.target.value)} className={inputCls}>
              <option value="">Selecione</option>{certs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        </div>

        {employeeId && (
          <details className="mt-4 rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Dados do vínculo no eSocial</summary>
            <form onSubmit={salvarVinculo} className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Matrícula"><input name="registrationNumber" maxLength={30} className={inputCls} /></Field>
              <Field label="Categoria eSocial (3 dígitos)"><input name="esocialCategoryCode" pattern="\d{3}" className={inputCls} /></Field>
              <div className="flex items-end gap-2"><button disabled={busy} className={btn2Cls}>Salvar</button>
                <button type="button" disabled={busy} onClick={confirmarVinculo} className={btn2Cls}>Confirmar que o vínculo já está no eSocial</button></div>
            </form></details>
        )}
        {employeeId && (
          <details className="mt-3 rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Cadastrar ASO</summary>
            <form onSubmit={criarAso} className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Tipo"><select name="examType" className={inputCls}>{EXAM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Data do ASO"><input name="examDate" type="date" required className={inputCls} /></Field>
              <Field label="Resultado"><select name="result" className={inputCls}><option value="apto">Apto</option><option value="inapto">Inapto</option></select></Field>
              <Field label="Médico do ASO"><input name="doctorName" required className={inputCls} /></Field>
              <Field label="CRM"><input name="doctorCrm" required maxLength={10} className={inputCls} /></Field>
              <Field label="UF do CRM"><input name="doctorCrmUf" required maxLength={2} className={inputCls} /></Field>
              <Field label="Coordenador do PCMSO"><select name="physician" className={inputCls}><option value="">Nenhum</option>{physicians.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <div className="flex items-end"><button disabled={busy} className={btn2Cls}>Cadastrar ASO</button></div>
            </form>
            <form onSubmit={novoMedico} className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-5">
              <Field label="CPF do coordenador"><input name="cpf" required className={inputCls} /></Field>
              <Field label="Nome"><input name="name" required className={inputCls} /></Field>
              <Field label="CRM"><input name="crm" required maxLength={10} className={inputCls} /></Field>
              <Field label="UF"><input name="crmUf" required maxLength={2} className={inputCls} /></Field>
              <div className="flex items-end"><button disabled={busy} className={btn2Cls}>Cadastrar coordenador</button></div>
            </form></details>
        )}
        {asoId && (
          <details className="mt-3 rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Adicionar exame do ASO (código da Tabela 27)</summary>
            <form onSubmit={addExame} className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Código Tabela 27 (4 dígitos)"><input name="procedureCode" required pattern="\d{4}" className={inputCls} /></Field>
              <Field label="Nome do exame"><input name="procedureName" required className={inputCls} /></Field>
              <Field label="Data do exame"><input name="examDate" type="date" required className={inputCls} /></Field>
              <Field label="Ordem (obrigatória no código 0281)"><select name="orderExam" className={inputCls}><option value="">Não se aplica</option><option value="1">Inicial</option><option value="2">Sequencial</option></select></Field>
              <Field label="Descrição (obrigatória no código 9999)"><input name="obsProc" className={inputCls} /></Field>
              <div className="flex items-end"><button disabled={busy} className={btn2Cls}>Adicionar exame</button></div>
            </form></details>
        )}

        <div className="mt-4 flex gap-2">
          <button disabled={busy || !asoId} onClick={verificar} className={btn2Cls}>Verificar pendências</button>
          <button disabled={busy || !asoId || !certId} onClick={gerar} className={btnCls}>Gerar evento S-2220 (rascunho)</button>
        </div>
        {issues && (
          issues.length === 0 ? <p role="status" className="mt-3 text-sm text-emerald-800">Nenhuma pendência. Pode gerar o evento.</p> : (
            <ul className="mt-3 space-y-1 text-sm">{issues.map((i, k) => (
              <li key={k} className="flex gap-2"><Badge tone={i.blocking ? 'crit' : 'warn'}>{i.blocking ? 'Bloqueia' : 'Atenção'}</Badge><span>{i.message}</span></li>))}</ul>
          )
        )}
      </Card>

      <Card title="3. Eventos">
        {events.length === 0 ? <p className="text-sm text-dash-muted">Nenhum evento ainda.</p> : (
          <ul className="space-y-3">
            {events.map((ev) => {
              const st = STATUS_LABEL[ev.status] ?? { label: ev.status, tone: 'info' as const };
              return (
                <li key={ev.id} className="rounded-lg border border-slate-200 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><strong>{ev.event_type}</strong><span>{ev.employee_name}</span><Badge tone={st.tone}>{st.label}</Badge><span className="text-dash-muted">{fmt(ev.created_at)}</span></div>
                  {ev.protocolo_lote && <p className="mt-1 text-dash-muted">Protocolo do lote: {ev.protocolo_lote}</p>}
                  {ev.nr_recibo && <p className="mt-1 font-medium text-emerald-800">Recibo: {ev.nr_recibo}</p>}
                  {ev.erro_mensagem && <p className="mt-1 text-red-800">{ev.erro_codigo ? `${ev.erro_codigo}: ` : ''}{ev.erro_mensagem}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ev.status === 'rascunho' && <button disabled={busy} onClick={() => acao(ev.id, 'authorize')} className={btn2Cls}>Autorizar</button>}
                    {ev.status === 'aguardando_transmissao' && <button disabled={busy} onClick={() => acao(ev.id, 'transmit')} className={btnCls}>Assinar e transmitir (Produção Restrita)</button>}
                    {ev.event_type === 'S-2220' && ev.status === 'processado' && <button disabled={busy} onClick={() => acao(ev.id, 'exclusion')} className={btn2Cls}>Excluir (S-3000)</button>}
                    {['transmitido', 'processando'].includes(ev.status) && <button disabled={busy} onClick={() => acao(ev.id, 'consult')} className={btn2Cls}>Consultar resultado</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
