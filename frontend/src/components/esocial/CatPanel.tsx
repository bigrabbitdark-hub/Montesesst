'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ApiError, api } from './esocial-api';
import { Field, btn2Cls, btnCls, fmt, inputCls } from './ui';

interface Employee { id: string; full_name: string }
interface Cert { id: string; label: string; status: string }
interface Acc { id: string; employee_name: string; acid_date: string; acid_type: number; cat_type: number; death: boolean }
interface Issue { code: string; message: string; blocking: boolean }

const NUM = new Set(['acidType', 'catType', 'catInitiative', 'locationType', 'laterality', 'attIssuerCouncil', 'attTreatmentDays', 'locInscriptionType']);
const BOOL = new Set(['death', 'policeNotified', 'hadLeave', 'attHospitalized', 'attLeave']);
const TIPO = ['', 'Típico', 'Doença', 'Trajeto'];
const CAT = ['', 'Inicial', 'Reabertura', 'Óbito'];

// Converte o FormData em JSON do backend: números, sim/não e vazio omitido (o backend valida de verdade).
function toBody(f: FormData, employeeId: string) {
  const body: Record<string, unknown> = { employeeId };
  f.forEach((raw, k) => {
    const v = String(raw).trim();
    if (v === '') return;
    body[k] = BOOL.has(k) ? v === 'S' : NUM.has(k) ? Number(v) : v;
  });
  return body;
}

const SN = (name: string, label: string, required = true) => (
  <Field label={label}><select name={name} required={required} defaultValue="" className={inputCls}><option value="" disabled={required}>{required ? 'Selecione' : 'Não informar'}</option><option value="N">Não</option><option value="S">Sim</option></select></Field>
);
const TXT = (name: string, label: string, o: { required?: boolean; type?: string; pattern?: string; max?: number; hint?: string } = {}) => (
  <Field label={label} hint={o.hint}><input name={name} type={o.type ?? 'text'} required={o.required} pattern={o.pattern} maxLength={o.max} className={inputCls} /></Field>
);

export function CatPanel({ onEventCreated }: { onEventCreated?: () => void }) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [accs, setAccs] = useState<Acc[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [certId, setCertId] = useState('');
  const [issues, setIssues] = useState<{ id: string; list: Issue[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, c, a] = await Promise.all([api<Employee[]>('/employees'), api<Cert[]>('/esocial/certificates'), api<Acc[]>('/esocial/accidents')]);
      setEmployees(e); setAccs(a);
      const ativos = c.filter((x) => x.status === 'ativo'); setCerts(ativos);
      setCertId((cur) => cur || ativos[0]?.id || '');
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ tipo: 'ok', texto: ok }); }
    catch (e) { const err = e as ApiError; if (err.issues) setIssues({ id: '', list: err.issues }); setMsg({ tipo: 'erro', texto: err.message }); }
    finally { setBusy(false); }
  };

  const salvar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget;
    run(async () => { await api('/esocial/accidents', { method: 'POST', json: toBody(new FormData(form), employeeId) }); form.reset(); await load(); }, 'CAT cadastrada. Agora verifique as pendências e gere o evento.');
  };
  const verificar = (id: string) => run(async () => {
    const r = await api<{ issues: Issue[] }>(`/esocial/events/diagnostics?accidentId=${id}${certId ? `&certificateId=${certId}` : ''}`);
    setIssues({ id, list: r.issues });
  }, 'Pendências atualizadas.');
  const gerar = (id: string) => run(async () => {
    await api('/esocial/events', { method: 'POST', json: { accidentId: id, certificateId: certId } });
    setIssues(null); onEventCreated?.();
  }, 'Rascunho do S-2210 gerado e validado no XSD oficial. Nada foi enviado: autorize e transmita na lista de eventos.');

  return (
    <Card title="4. Acidente de trabalho (CAT, evento S-2210)">
      <div role="note" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Dado de saúde sensível. Os códigos das tabelas (13, 14, 15 e 17) e o CID vêm do atestado e das tabelas oficiais do eSocial; o sistema não os completa sozinho. Quem emite a CAT, no leiaute do eSocial, é a empresa.
      </div>
      <div aria-live="polite">{msg && <p role={msg.tipo === 'erro' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-4 py-3 text-sm ${msg.tipo === 'erro' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{msg.texto}</p>}</div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Funcionário acidentado"><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}><option value="">Selecione</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
        <Field label="Certificado a usar"><select value={certId} onChange={(e) => setCertId(e.target.value)} className={inputCls}><option value="">Selecione</option>{certs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
      </div>

      {employeeId && (
        <details className="mt-4 rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Cadastrar CAT</summary>
          <form onSubmit={salvar} className="mt-3 space-y-5">
            <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Acidente</legend>
              {TXT('acidDate', 'Data do acidente', { type: 'date', required: true })}
              <Field label="Tipo de acidente"><select name="acidType" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="1">Típico</option><option value="2">Doença</option><option value="3">Trajeto</option></select></Field>
              <Field label="Tipo de CAT"><select name="catType" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="1">Inicial</option><option value="2">Reabertura</option><option value="3">Comunicação de óbito</option></select></Field>
              {TXT('acidTime', 'Hora do acidente (HHMM)', { pattern: '([01]\\d|2[0-3])[0-5]\\d', max: 4, hint: 'Não preencher em caso de doença' })}
              {TXT('hoursWorkedBefore', 'Horas trabalhadas antes (HHMM)', { pattern: '\\d{2}[0-5]\\d', max: 4, hint: 'Não preencher em caso de doença' })}
              {SN('death', 'Houve óbito?')}
              {TXT('deathDate', 'Data do óbito', { type: 'date' })}
              {SN('policeNotified', 'Comunicou à autoridade policial?')}
              <Field label="Iniciativa da CAT"><select name="catInitiative" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="1">Empregador</option><option value="2">Ordem judicial</option><option value="3">Determinação de órgão fiscalizador</option></select></Field>
              {TXT('causingSituationCode', 'Situação geradora (Tabela 15, 9 dígitos)', { required: true, pattern: '\\d{9}', max: 9 })}
              {TXT('lastWorkDay', 'Último dia trabalhado', { type: 'date', hint: 'Obrigatório para acidentes desde 16/01/2023' })}
              {SN('hadLeave', 'Houve afastamento?', false)}
              {TXT('catNotes', 'Observações da CAT', { max: 999 })}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Local</legend>
              <Field label="Tipo de local"><select name="locationType" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="1">Estabelecimento do empregador (Brasil)</option><option value="2">Estabelecimento do empregador (exterior)</option><option value="3">Estabelecimento de terceiros</option><option value="4">Via pública</option><option value="5">Área rural</option><option value="6">Embarcação</option><option value="9">Outros</option></select></Field>
              {TXT('locationDescription', 'Especificação do local', { max: 255 })}
              {TXT('locStreet', 'Logradouro', { required: true, max: 100 })}
              {TXT('locNumber', 'Número (use S/N se não houver)', { required: true, max: 10 })}
              {TXT('locDistrict', 'Bairro', { max: 90 })}
              {TXT('locCep', 'CEP (8 dígitos)', { pattern: '\\d{8}', max: 8 })}
              {TXT('locCityCode', 'Código do município (IBGE, 7 dígitos)', { pattern: '\\d{7}', max: 7 })}
              {TXT('locUf', 'UF', { max: 2 })}
              <Field label="Tipo de inscrição do local"><select name="locInscriptionType" defaultValue="" className={inputCls}><option value="">Não informar</option><option value="1">CNPJ</option><option value="3">CAEPF</option><option value="4">CNO</option></select></Field>
              {TXT('locInscriptionNumber', 'Número de inscrição do local', { max: 14, hint: 'Obrigatório em estabelecimento do empregador ou de terceiros' })}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Lesão</legend>
              {TXT('bodyPartCode', 'Parte atingida (Tabela 13, 9 dígitos)', { required: true, pattern: '\\d{9}', max: 9 })}
              <Field label="Lateralidade"><select name="laterality" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="0">Não aplicável</option><option value="1">Esquerda</option><option value="2">Direita</option><option value="3">Ambas</option></select></Field>
              {TXT('causingAgentCode', 'Agente causador (Tabela 14, 9 dígitos)', { required: true, pattern: '\\d{9}', max: 9 })}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Atestado médico</legend>
              {TXT('attDate', 'Data do atendimento', { type: 'date', required: true })}
              {TXT('attTime', 'Hora do atendimento (HHMM)', { required: true, pattern: '([01]\\d|2[0-3])[0-5]\\d', max: 4 })}
              {SN('attHospitalized', 'Houve internação?')}
              {TXT('attTreatmentDays', 'Duração estimada do tratamento (dias)', { type: 'number', required: true })}
              {SN('attLeave', 'Houve afastamento durante o tratamento?')}
              {TXT('attInjuryCode', 'Natureza da lesão (Tabela 17, 9 dígitos)', { required: true, pattern: '\\d{9}', max: 9 })}
              {TXT('attInjuryDetail', 'Descrição complementar da lesão', { max: 200 })}
              {TXT('attProbableDiagnosis', 'Diagnóstico provável', { max: 100 })}
              {TXT('attCid', 'CID (3 a 4 caracteres)', { required: true, pattern: '[A-Za-z0-9]{3,4}', max: 4 })}
              {TXT('attIssuerName', 'Nome do emitente', { required: true, max: 70 })}
              <Field label="Órgão de classe"><select name="attIssuerCouncil" required defaultValue="" className={inputCls}><option value="" disabled>Selecione</option><option value="1">CRM</option><option value="2">CRO</option><option value="3">RMS</option></select></Field>
              {TXT('attIssuerNumber', 'Número no órgão de classe', { required: true, max: 14 })}
              {TXT('attIssuerUf', 'UF do órgão de classe', { max: 2 })}
            </fieldset>
            <div><button disabled={busy} className={btnCls}>Cadastrar CAT</button></div>
          </form>
        </details>
      )}

      <ul className="mt-4 space-y-3">
        {accs.length === 0 && <li className="text-sm text-dash-muted">Nenhuma CAT cadastrada.</li>}
        {accs.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-200 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><strong>{a.employee_name}</strong><span>{fmt(a.acid_date)}</span><Badge tone="info">{TIPO[a.acid_type]}</Badge><Badge tone={a.cat_type === 1 ? 'info' : 'warn'}>CAT {CAT[a.cat_type]}</Badge>{a.death && <Badge tone="crit">Óbito</Badge>}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => verificar(a.id)} className={btn2Cls}>Verificar pendências</button>
              <button disabled={busy || !certId} onClick={() => gerar(a.id)} className={btnCls}>Gerar evento S-2210 (rascunho)</button>
            </div>
            {issues?.id === a.id && (issues.list.length === 0
              ? <p role="status" className="mt-2 text-emerald-800">Nenhuma pendência. Pode gerar o evento.</p>
              : <ul className="mt-2 space-y-1">{issues.list.map((i, k) => <li key={k} className="flex gap-2"><Badge tone={i.blocking ? 'crit' : 'warn'}>{i.blocking ? 'Bloqueia' : 'Atenção'}</Badge><span>{i.message}</span></li>)}</ul>)}
          </li>
        ))}
      </ul>
    </Card>
  );
}
