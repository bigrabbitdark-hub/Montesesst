'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { FileInput } from './FileInput';
import { Badge, Tone } from './ui/Badge';
import { addMonths, formatDateBR } from '@/lib/date-only';

type Situacao = 'valido' | 'vencendo' | 'vencido' | 'sem_vencimento';
type ExpiresSource = 'manual' | 'rule' | null;

interface DocumentRow {
  id: string;
  category: string;
  title: string;
  file_name: string;
  valid_from: string | null;
  expires_at: string | null;
  expires_source: ExpiresSource;
  validity_months_applied: number | null;
  situacao: Situacao;
  uploaded_by_user_id: string;
  company_unit_id: string | null;
  created_at: string;
}

interface ValidityRule {
  category: string;
  validity_months: number | null;
  alert_days: number;
}

interface CompanyUnitOption {
  id: string;
  name: string;
  is_matriz: boolean;
}

interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}

interface ClassifyBatchItem {
  filename: string;
  suggested_category: string | null;
  suggested_title: string | null;
  suggested_expires_at: string | null;
  needs_review: boolean;
}

interface BatchRow {
  file: File;
  category: string;
  title: string;
  validFrom: string;
  expiresAt: string;
  expiresAtManuallyEdited: boolean;
  needsReview: boolean;
  importStatus: 'pendente' | 'sucesso' | 'erro';
}

// Rótulos de exibição pra QUALQUER categoria que possa aparecer numa
// listagem (documentos já salvos, itens da agenda combinada) — inclui
// 'epi' (sintética, usada só por episToAgendaItems, nunca gravada em
// `documents`) e as categorias `cipa_*` (gravadas só internamente por
// outros módulos, nunca pelo formulário de upload manual abaixo).
const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
  ltcat: 'LTCAT',
  lip: 'LIP',
  epi: 'EPI',
  cipa_ata: 'Ata da CIPA',
  cipa_comunicado: 'Comunicado da CIPA',
  cipa_documento_eleitoral: 'Documento eleitoral da CIPA',
  cipa_anexo: 'Anexo da CIPA',
  relatorio_visita: 'Relatório de Visita',
};

// Categorias que o formulário de upload manual (abaixo) oferece —
// precisa bater exatamente com o @IsIn de CreateDocumentDto no
// backend. 'epi' e as `cipa_*` ficam de fora de propósito: hoje
// resultam em 400 se enviadas manualmente (gravadas só internamente).
const UPLOAD_CATEGORIES = ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'ltcat', 'lip'];

const MAX_BATCH_FILES = 10;
const MAX_BATCH_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface AgendaItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
}

interface AgendaGroup {
  label: string;
  items: AgendaItem[];
}

interface EpiRow {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  equipment_group: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Mantido por compatibilidade com usos existentes neste arquivo.
// Para datas vindas do backend (que chegam como 'AAAA-MM-DD' puro),
// o projeto hoje prefere `formatDateBR` de `@/lib/date-only`, que
// não depende de fuso. Aqui só serve pra `formatMonthLabel`.
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatMonthLabel(isoDate: string): string {
  const [year, month] = isoDate.slice(0, 10).split('-').map(Number);
  return capitalize(
    new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}

function documentsToAgendaItems(documents: DocumentRow[]): AgendaItem[] {
  return documents
    .filter((doc): doc is DocumentRow & { expires_at: string } => doc.expires_at !== null)
    .map((doc) => ({ id: doc.id, category: doc.category, title: doc.title, expires_at: doc.expires_at }));
}

function episToAgendaItems(epis: EpiRow[]): AgendaItem[] {
  return epis
    .filter((epi): epi is EpiRow & { ca_valid_until: string } => epi.ca_valid_until !== null)
    .map((epi) => ({
      id: epi.id,
      category: 'epi',
      title: `CA ${epi.ca_number} — ${epi.equipment_group}`,
      expires_at: epi.ca_valid_until,
    }));
}

function groupAgendaByMonth(items: AgendaItem[]): AgendaGroup[] {
  const sorted = [...items].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const groups: AgendaGroup[] = [];
  for (const item of sorted) {
    const label = formatMonthLabel(item.expires_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

function situacaoLabel(s: Situacao): string {
  switch (s) {
    case 'valido':
      return 'Válido';
    case 'vencendo':
      return 'Próximo do vencimento';
    case 'vencido':
      return 'Vencido';
    case 'sem_vencimento':
      return 'Sem vencimento definido';
    default:
      return 'Sem vencimento definido';
  }
}

function situacaoTone(s: Situacao): Tone {
  switch (s) {
    case 'valido':
      return 'ok';
    case 'vencendo':
      return 'warn';
    case 'vencido':
      return 'crit';
    case 'sem_vencimento':
      return 'info';
    default:
      return 'info';
  }
}

export function DocumentsPanel({ tenantId }: { tenantId?: string }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('pgr');
  const [title, setTitle] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [expiresAtManuallyEdited, setExpiresAtManuallyEdited] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [listError, setListError] = useState('');
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'analisando' | 'importando' | 'erro'>('idle');
  const [batchError, setBatchError] = useState('');
  const [validityRules, setValidityRules] = useState<ValidityRule[] | null>(null);
  const [validityRulesWarning, setValidityRulesWarning] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editError, setEditError] = useState('');
  const [editStatus, setEditStatus] = useState<'idle' | 'salvando'>('idle');

  function currentUserId(): string | null {
    const raw = localStorage.getItem('montese_user');
    if (!raw) return null;
    return JSON.parse(raw).id;
  }

  function listUrl(): string {
    return tenantId ? `/api/documents?tenant_id=${tenantId}` : '/api/documents';
  }

  function complianceUrl(): string {
    return tenantId ? `/api/documents/compliance?tenant_id=${tenantId}` : '/api/documents/compliance';
  }

  function episUrl(): string {
    return tenantId ? `/api/epis?tenant_id=${tenantId}` : '/api/epis';
  }

  function rulesUrl(): string {
    return '/api/documents/validity-rules';
  }

  const ruleForCategory = useCallback(
    (cat: string): ValidityRule | null => {
      if (!validityRules) return null;
      return validityRules.find((r) => r.category === cat) ?? null;
    },
    [validityRules],
  );

  // Vencimento que o formulário de envio individual "sugere" agora
  // (sem nunca escrever de novo se o usuário já tiver editado à mão).
  const calculatedExpiresAt = useMemo(() => {
    if (expiresAtManuallyEdited) return null;
    if (!validFrom) return null;
    const rule = ruleForCategory(category);
    if (!rule || rule.validity_months === null) return null;
    return addMonths(validFrom, rule.validity_months);
  }, [validFrom, category, expiresAtManuallyEdited, ruleForCategory]);

  async function loadEpis() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(episUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setEpis(await res.json());
      }
    } catch {
      // agenda mescla documentos+EPI; falha aqui só deixa a parte de EPI
      // de fora, sem sobrescrever o listError já usado por loadDocuments.
    }
  }

  async function loadCompliance() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(complianceUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setCompliance(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar o score de conformidade.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadDocuments() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(listUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setDocuments(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os documentos.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
    setLoading(false);
  }

  async function loadUnits() {
    // Só busca as unidades quando é a própria empresa vendo seus próprios
    // documentos — GET /company-units não tem parâmetro tenant_id (só
    // enxerga via RLS do próprio contexto), então pra técnico/parceiro
    // vendo documento de uma empresa vinculada (tenantId setado) essa
    // chamada não traria nada útil hoje.
    if (tenantId) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUnits(await res.json());
    } catch {
      // seletor de matriz/filial fica vazio; upload continua funcionando
      // sem essa informação
    }
  }

  async function loadValidityRules() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(rulesUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = (await res.json()) as ValidityRule[];
        setValidityRules(data);
        setValidityRulesWarning('');
      } else {
        setValidityRules(null);
        setValidityRulesWarning(
          'Não foi possível carregar as regras de validade. O vencimento pode ser informado manualmente.',
        );
      }
    } catch {
      setValidityRules(null);
      setValidityRulesWarning(
        'Não foi possível carregar as regras de validade. O vencimento pode ser informado manualmente.',
      );
    }
  }

  useEffect(() => {
    loadDocuments();
    loadCompliance();
    loadEpis();
    loadUnits();
    loadValidityRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quando o usuário troca a categoria ou a data de início e ainda não
  // editou o vencimento à mão, mantém o campo de vencimento em sincronia
  // com o cálculo automático. Nunca preenche sozinho se a data de início
  // estiver vazia — é o usuário quem decide.
  useEffect(() => {
    if (expiresAtManuallyEdited) return;
    if (calculatedExpiresAt) {
      setExpiresAt(calculatedExpiresAt);
    } else if (validityRules !== null) {
      // regra ausente ou data de início vazia: vencimento volta a ficar
      // vazio, a menos que o usuário já tenha digitado algo.
      setExpiresAt('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedExpiresAt, expiresAtManuallyEdited]);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (validFrom && expiresAt && expiresAt < validFrom) {
      setErrorMessage('O vencimento não pode ser anterior à data de início da validade.');
      setStatus('erro');
      return;
    }
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    if (validFrom) formData.append('valid_from', validFrom);
    if (expiresAt) formData.append('expires_at', expiresAt);
    if (tenantId) formData.append('tenant_id', tenantId);
    if (companyUnitId) formData.append('company_unit_id', companyUnitId);
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setTitle('');
        setValidFrom('');
        setExpiresAt('');
        setExpiresAtManuallyEdited(false);
        setFile(null);
        setCompanyUnitId('');
        setStatus('idle');
        loadDocuments();
        loadCompliance();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível enviar o documento.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  function handleSelectBatchFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    setBatchRows([]);

    if (selected.length > MAX_BATCH_FILES) {
      setBatchFiles([]);
      setBatchError(`Selecione no máximo ${MAX_BATCH_FILES} arquivos por vez (você selecionou ${selected.length}).`);
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_BATCH_FILE_SIZE_BYTES);
    if (oversized) {
      setBatchFiles([]);
      setBatchError(`O arquivo "${oversized.name}" tem mais de 10MB — remova-o e selecione novamente.`);
      return;
    }

    setBatchFiles(selected);
    setBatchError('');
  }

  async function handleAnalyzeBatch() {
    if (batchFiles.length === 0) return;
    setBatchStatus('analisando');
    setBatchError('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    batchFiles.forEach((file) => formData.append('files', file));

    try {
      const res = await fetch('/api/documents/classify-batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const items: ClassifyBatchItem[] = await res.json();
        setBatchRows(
          items.map((item, i) => ({
            file: batchFiles[i],
            category: item.suggested_category ?? '',
            title: item.suggested_title ?? '',
            validFrom: '',
            expiresAt: item.suggested_expires_at ?? '',
            expiresAtManuallyEdited: false,
            needsReview: item.needs_review,
            importStatus: 'pendente' as const,
          })),
        );
        setBatchStatus('idle');
        return;
      }
      const body = await res.json().catch(() => null);
      setBatchError(body?.message ?? 'Não foi possível analisar os documentos.');
      setBatchStatus('erro');
    } catch {
      setBatchError('Não foi possível conectar ao servidor.');
      setBatchStatus('erro');
    }
  }

  function updateBatchRow(index: number, changes: Partial<BatchRow>) {
    setBatchRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  function batchCalculatedExpiresAt(row: BatchRow): string | null {
    if (row.expiresAtManuallyEdited) return null;
    if (!row.validFrom) return null;
    const rule = ruleForCategory(row.category);
    if (!rule || rule.validity_months === null) return null;
    return addMonths(row.validFrom, rule.validity_months);
  }

  function applyBatchCalculation(index: number) {
    const row = batchRows[index];
    if (!row) return;
    const next = batchCalculatedExpiresAt(row);
    if (next) {
      updateBatchRow(index, { expiresAt: next });
    } else if (validityRules !== null) {
      updateBatchRow(index, { expiresAt: '' });
    }
  }

  function revertBatchToAuto(index: number) {
    const row = batchRows[index];
    if (!row) return;
    updateBatchRow(index, { expiresAtManuallyEdited: false });
    applyBatchCalculation(index);
  }

  async function handleImportBatch() {
    setBatchStatus('importando');
    const token = localStorage.getItem('montese_token');

    for (let i = 0; i < batchRows.length; i++) {
      if (batchRows[i].importStatus === 'sucesso') continue;
      const row = batchRows[i];
      const rowFormData = new FormData();
      rowFormData.append('category', row.category);
      rowFormData.append('title', row.title);
      if (row.validFrom) rowFormData.append('valid_from', row.validFrom);
      if (row.expiresAt) rowFormData.append('expires_at', row.expiresAt);
      if (tenantId) rowFormData.append('tenant_id', tenantId);
      rowFormData.append('file', row.file);

      try {
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: rowFormData,
        });
        updateBatchRow(i, { importStatus: res.ok ? 'sucesso' : 'erro' });
      } catch {
        updateBatchRow(i, { importStatus: 'erro' });
      }
    }

    setBatchStatus('idle');
    loadDocuments();
    loadCompliance();
  }

  async function handleDownload(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/documents/${id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, '_blank');
      } else {
        setListError('Não foi possível baixar o documento.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function handleDelete(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadDocuments();
        loadCompliance();
      } else {
        setListError('Não foi possível apagar o documento.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function handlePatchValidity(docId: string, newValidFrom: string, newExpiresAt: string) {
    if (newValidFrom && newExpiresAt && newExpiresAt < newValidFrom) {
      setEditError('O vencimento não pode ser anterior à data de início da validade.');
      return;
    }
    setEditStatus('salvando');
    setEditError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/documents/${docId}/validity`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valid_from: newValidFrom || null,
          expires_at: newExpiresAt || null,
        }),
      });
      if (res.ok) {
        setEditingDocId(null);
        setEditStatus('idle');
        setEditError('');
        loadDocuments();
        loadCompliance();
        return;
      }
      if (res.status === 403) {
        setEditError('Só quem enviou o documento ou o administrador pode alterar as datas.');
      } else {
        const body = await res.json().catch(() => null);
        setEditError(body?.message ?? 'Não foi possível atualizar as datas.');
      }
      setEditStatus('idle');
    } catch {
      setEditError('Não foi possível conectar ao servidor.');
      setEditStatus('idle');
    }
  }

  const userId = currentUserId();
  const agendaGroups = groupAgendaByMonth([...documentsToAgendaItems(documents), ...episToAgendaItems(epis)]);
  const canImportBatch =
    batchRows.length > 0 && batchRows.every((row) => row.category !== '' && row.title.trim() !== '');

  const currentRule = ruleForCategory(category);
  const ruleHasMonths = currentRule !== null && currentRule.validity_months !== null;
  const isCurrentCalculated = !expiresAtManuallyEdited && calculatedExpiresAt !== null;

  if (loading) {
    return <p className="text-brand-700">Carregando documentos...</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {compliance && (
        <section className="rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Conformidade</h2>
          <p className="mt-2 text-3xl font-bold text-brand-900">
            {compliance.score === null ? 'Sem dados ainda' : `${compliance.score}%`}
          </p>
          {compliance.pendencias.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-red-600">Pendências</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-red-600">
                {compliance.pendencias.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (venceu há {item.dias_vencido} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.avisos.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-yellow-700">Vencendo em breve</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-yellow-700">
                {compliance.avisos.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (vence em {item.dias_restantes} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.score !== null && compliance.pendencias.length === 0 && compliance.avisos.length === 0 && (
            <p className="mt-4 text-sm text-green-700">Tudo em dia.</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Agenda de vencimentos</h2>
        {agendaGroups.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum vencimento cadastrado.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            {agendaGroups.map((group) => (
              <div key={group.label}>
                <h3 className="text-sm font-bold text-brand-900">{group.label}</h3>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-brand-700">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      {CATEGORY_LABELS[item.category]} — {item.title} (
                      {formatDate(item.expires_at)})
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Enviar documento</h2>
        {validityRulesWarning && (
          <p className="mt-2 text-sm text-amber-700">{validityRulesWarning}</p>
        )}
        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Categoria
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setExpiresAtManuallyEdited(false);
              }}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {UPLOAD_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Título
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Início da validade
            <input
              type="date"
              value={validFrom}
              onChange={(e) => {
                setValidFrom(e.target.value);
                setExpiresAtManuallyEdited(false);
              }}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Vencimento (opcional)
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => {
                setExpiresAt(e.target.value);
                setExpiresAtManuallyEdited(true);
              }}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {isCurrentCalculated && currentRule && currentRule.validity_months !== null && (
            <p className="text-sm text-brand-700" data-testid="upload-calculated-hint">
              Vencimento calculado: {formatDateBR(calculatedExpiresAt)}. Calculado por regra
              configurável de {currentRule.validity_months} meses. Parâmetro operacional da
              plataforma, não é prazo legal.
            </p>
          )}
          {expiresAtManuallyEdited && (
            <div className="flex flex-wrap items-center gap-3" data-testid="upload-manual-hint">
              <p className="text-sm text-brand-700">Data informada manualmente.</p>
              {validFrom && ruleHasMonths && (
                <button
                  type="button"
                  onClick={() => {
                    setExpiresAtManuallyEdited(false);
                    const next = addMonths(validFrom, currentRule!.validity_months!);
                    setExpiresAt(next);
                  }}
                  className="text-sm text-brand-500 hover:underline"
                >
                  Voltar ao cálculo
                </button>
              )}
            </div>
          )}
          {validFrom && !ruleHasMonths && validityRules !== null && (
            <p className="text-sm text-brand-700" data-testid="upload-no-rule-hint">
              Este tipo de documento não tem vencimento automático definido. Preencha o
              vencimento manualmente se aplicável.
            </p>
          )}
          {units.length > 0 && (
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Matriz ou filial (opcional)
              <select
                value={companyUnitId}
                onChange={(e) => setCompanyUnitId(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              >
                <option value="">Não especificado</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.is_matriz ? `${unit.name} (matriz)` : unit.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Arquivo (PDF, JPG ou PNG, até 10MB)
            <FileInput file={file} onChange={setFile} accept=".pdf,.jpg,.jpeg,.png" label="Escolher arquivo" />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading' || !file}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Enviando...' : 'Enviar documento'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Upload em lote</h2>
        <p className="mt-1 text-sm text-brand-700">
          Selecione vários PDFs de uma vez — vamos sugerir categoria, título e validade pra cada um.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            id="batch-file-input"
            type="file"
            multiple
            accept=".pdf,application/pdf"
            onChange={handleSelectBatchFiles}
            className="hidden"
          />
          <label
            htmlFor="batch-file-input"
            className="cursor-pointer rounded-md border border-brand-500 px-4 py-2 text-sm font-medium text-brand-500 hover:bg-brand-50"
          >
            Escolher arquivos
          </label>
          <span className="text-sm text-brand-700">
            {batchFiles.length === 0 ? 'Nenhum arquivo selecionado' : `${batchFiles.length} arquivo(s) selecionado(s)`}
          </span>
          <button
            type="button"
            onClick={handleAnalyzeBatch}
            disabled={batchFiles.length === 0 || batchStatus === 'analisando'}
            className="rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {batchStatus === 'analisando' ? 'Analisando...' : 'Analisar documentos'}
          </button>
        </div>
        {batchError && <p className="mt-2 text-sm text-red-600">{batchError}</p>}

        {batchRows.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {batchRows.map((row, i) => {
              const rowIncomplete = row.category === '' || row.title.trim() === '';
              const rowRule = ruleForCategory(row.category);
              const rowRuleHasMonths = rowRule !== null && rowRule.validity_months !== null;
              const rowCalculated = batchCalculatedExpiresAt(row);
              return (
              <div key={i} className="rounded-md border border-brand-100 p-4">
                <p className="text-sm font-medium text-brand-900">
                  {row.file.name}
                  {row.needsReview && <span className="ml-2 text-xs text-amber-700">⚠️ revisar manualmente</span>}
                  {rowIncomplete && <span className="ml-2 text-xs text-red-600">⚠️ preencha categoria e título</span>}
                </p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1 text-sm text-brand-900">
                    Categoria
                    <select
                      value={row.category}
                      onChange={(e) => {
                        updateBatchRow(i, { category: e.target.value, expiresAtManuallyEdited: false });
                        applyBatchCalculation(i);
                      }}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    >
                      <option value="">Selecione...</option>
                      {UPLOAD_CATEGORIES.map((value) => (
                        <option key={value} value={value}>
                          {CATEGORY_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-brand-900">
                    Título
                    <input
                      value={row.title}
                      onChange={(e) => updateBatchRow(i, { title: e.target.value })}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-brand-900">
                    Início da validade
                    <input
                      type="date"
                      value={row.validFrom}
                      onChange={(e) => {
                        updateBatchRow(i, { validFrom: e.target.value, expiresAtManuallyEdited: false });
                        applyBatchCalculation(i);
                      }}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-brand-900">
                    Vencimento (opcional)
                    <input
                      type="date"
                      value={row.expiresAt}
                      onChange={(e) => updateBatchRow(i, { expiresAt: e.target.value, expiresAtManuallyEdited: true })}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                </div>
                {!row.expiresAtManuallyEdited && rowCalculated && rowRule && rowRule.validity_months !== null && (
                  <p className="mt-2 text-xs text-brand-700">
                    Vencimento calculado: {formatDateBR(rowCalculated)}. Calculado por regra
                    configurável de {rowRule.validity_months} meses. Parâmetro operacional da
                    plataforma, não é prazo legal.
                  </p>
                )}
                {row.expiresAtManuallyEdited && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-xs text-brand-700">Data informada manualmente.</p>
                    {row.validFrom && rowRuleHasMonths && (
                      <button
                        type="button"
                        onClick={() => revertBatchToAuto(i)}
                        className="text-xs text-brand-500 hover:underline"
                      >
                        Voltar ao cálculo
                      </button>
                    )}
                  </div>
                )}
                {row.validFrom && !rowRuleHasMonths && validityRules !== null && (
                  <p className="mt-2 text-xs text-brand-700">
                    Este tipo de documento não tem vencimento automático definido.
                  </p>
                )}
                {row.importStatus === 'sucesso' && <p className="mt-2 text-sm text-green-700">Importado.</p>}
                {row.importStatus === 'erro' && <p className="mt-2 text-sm text-red-600">Falha ao importar.</p>}
              </div>
              );
            })}
            <button
              type="button"
              onClick={handleImportBatch}
              disabled={!canImportBatch || batchStatus === 'importando'}
              className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {batchStatus === 'importando' ? 'Importando...' : 'Importar todos'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Documentos</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {documents.map((doc) => (
              <DocumentListItem
                key={doc.id}
                doc={doc}
                currentUserId={userId}
                isEditing={editingDocId === doc.id}
                editError={editingDocId === doc.id ? editError : ''}
                editStatus={editingDocId === doc.id ? editStatus : 'idle'}
                validityRules={validityRules}
                onStartEdit={() => {
                  setEditError('');
                  setEditingDocId(doc.id);
                }}
                onCancelEdit={() => {
                  setEditingDocId(null);
                  setEditError('');
                }}
                onSave={(validFromValue, expiresAtValue) => handlePatchValidity(doc.id, validFromValue, expiresAtValue)}
                onDownload={() => handleDownload(doc.id)}
                onDelete={() => handleDelete(doc.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface DocumentListItemProps {
  doc: DocumentRow;
  currentUserId: string | null;
  isEditing: boolean;
  editError: string;
  editStatus: 'idle' | 'salvando';
  validityRules: ValidityRule[] | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (validFrom: string, expiresAt: string) => void;
  onDownload: () => void;
  onDelete: () => void;
}

function DocumentListItem({
  doc,
  currentUserId,
  isEditing,
  editError,
  editStatus,
  validityRules,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDownload,
  onDelete,
}: DocumentListItemProps) {
  const [editValidFrom, setEditValidFrom] = useState(doc.valid_from ?? '');
  const [editExpiresAt, setEditExpiresAt] = useState(doc.expires_at ?? '');
  const [editManuallyEdited, setEditManuallyEdited] = useState(false);

  const rule = useMemo<ValidityRule | null>(() => {
    if (!validityRules) return null;
    return validityRules.find((r) => r.category === doc.category) ?? null;
  }, [validityRules, doc.category]);

  const ruleHasMonths = rule !== null && rule.validity_months !== null;

  const editCalculated = useMemo(() => {
    if (editManuallyEdited) return null;
    if (!editValidFrom) return null;
    if (!rule || rule.validity_months === null) return null;
    return addMonths(editValidFrom, rule.validity_months);
  }, [editValidFrom, editManuallyEdited, rule]);

  useEffect(() => {
    if (editManuallyEdited) return;
    if (editCalculated) {
      setEditExpiresAt(editCalculated);
    } else if (validityRules !== null) {
      setEditExpiresAt('');
    }
  }, [editCalculated, editManuallyEdited, validityRules]);

  const canEdit = doc.uploaded_by_user_id === currentUserId;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-brand-100 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-brand-900">{CATEGORY_LABELS[doc.category] ?? doc.category}</strong>
          <span className="text-brand-700">— {doc.title}</span>
          <Badge tone={situacaoTone(doc.situacao)}>{situacaoLabel(doc.situacao)}</Badge>
        </div>
        <p className="mt-1 text-brand-700" data-testid={`doc-dates-${doc.id}`}>
          Início: {doc.valid_from ? formatDateBR(doc.valid_from) : 'Não informado'}
          {' · '}
          Vencimento: {doc.expires_at ? formatDateBR(doc.expires_at) : 'Não definido'}
          {doc.expires_source === 'rule' && doc.expires_at && (
            <span className="ml-1 text-xs text-brand-500">
              (calculado por regra
              {rule && rule.validity_months !== null ? ` de ${rule.validity_months} meses` : ''})
            </span>
          )}
        </p>
        {isEditing && (
          <div className="mt-3 flex flex-col gap-3 rounded-md border border-brand-100 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Início da validade
                <input
                  type="date"
                  value={editValidFrom}
                  onChange={(e) => {
                    setEditValidFrom(e.target.value);
                    setEditManuallyEdited(false);
                  }}
                  className="rounded-md border border-brand-100 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Vencimento
                <input
                  type="date"
                  value={editExpiresAt}
                  onChange={(e) => {
                    setEditExpiresAt(e.target.value);
                    setEditManuallyEdited(true);
                  }}
                  className="rounded-md border border-brand-100 px-3 py-2"
                />
              </label>
            </div>
            {!editManuallyEdited && editCalculated && rule && rule.validity_months !== null && (
              <p className="text-xs text-brand-700">
                Vencimento calculado: {formatDateBR(editCalculated)}. Calculado por regra
                configurável de {rule.validity_months} meses.
              </p>
            )}
            {editManuallyEdited && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-brand-700">Data informada manualmente.</p>
                {editValidFrom && ruleHasMonths && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditManuallyEdited(false);
                      setEditExpiresAt(addMonths(editValidFrom, rule!.validity_months!));
                    }}
                    className="text-xs text-brand-500 hover:underline"
                  >
                    Voltar ao cálculo
                  </button>
                )}
              </div>
            )}
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onSave(editValidFrom, editExpiresAt)}
                disabled={editStatus === 'salvando'}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {editStatus === 'salvando' ? 'Salvando...' : 'Salvar datas'}
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-md border border-brand-100 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={onDownload} className="text-brand-500 hover:underline">
          Baixar
        </button>
        {canEdit && !isEditing && (
          <button onClick={onStartEdit} className="text-brand-500 hover:underline">
            Editar datas
          </button>
        )}
        {doc.uploaded_by_user_id === currentUserId && (
          <button onClick={onDelete} className="text-red-600 hover:underline">
            Apagar
          </button>
        )}
      </div>
    </li>
  );
}
