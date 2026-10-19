import { Logger } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { envInt } from '../common/env';
import { entryData, inflatedSizeUpTo, parseZipDirectory } from '../common/files/file-content.util';

// Leitura de texto LIMITADA, exclusiva do cadastro de funcionários. Os utilitários compartilhados (extractFullText etc.)
// não têm teto de tempo/memória: um DOCX de dezenas de KB que infla para 40 MB derruba o processo. Aqui o tamanho
// inflado é medido em fluxo ANTES do mammoth, e o PDF é lido por no máximo 50 páginas e 20 s.
const logger = new Logger('EmployeeDocumentText');
const MB = 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
const DOCX_MAX_DOCUMENT_XML = 3 * MB;
const DOCX_MAX_OTHER_XML = 4 * MB; // styles, numbering, footnotes, rels...
const DOCX_MAX_TOTAL = 20 * MB;
const DOCX_MAX_ENTRIES = 200;
const DOCX_TIMEOUT_MS = 15_000;
const PDF_MAX_PAGES = 50;
const PDF_TIMEOUT_MS = 20_000;
const WORKER_HEAP_MB = 768;

export const TOO_BIG_DETAIL = 'Documento grande demais para leitura automática. Envie a planilha modelo (.xlsx) ou uma versão menor.';
export const NO_TEXT_DETAIL = 'Documento sem texto legível (possivelmente escaneado). A leitura de imagens ainda não está disponível.';
export const EMPTY_DOCX_DETAIL = 'O documento não tem texto.';
export const ENCRYPTED_DETAIL = 'Documento protegido por senha não pode ser lido.';
export const PDF_PAGES_DETAIL = `Documento com mais de ${PDF_MAX_PAGES} páginas: só as primeiras ${PDF_MAX_PAGES} foram lidas.`;

export type BoundedText = { status: 'ok'; text: string; detail?: string } | { status: 'ilegivel' | 'erro'; detail: string };
const ilegivel = (detail: string): BoundedText => ({ status: 'ilegivel', detail });
export const BUSY_DETAIL = 'Muitos documentos em leitura agora. Reenvie em alguns instantes.';

// ---------- Semáforo de leituras pesadas (por processo) ----------
// Bombas de PDF concorrentes somam memória (~1,2 GB por worker até o terminate) e o rate limit é por IP. Só N leituras
// (mammoth/worker de PDF) ao mesmo tempo; as demais esperam numa fila curta; fila cheia ou espera longa => `erro` estático.
// Os limites são lidos a cada chamada (env) para poderem ser ajustados sem reiniciar e para os testes.
const clampInt = (name: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, envInt(name, fallback)));
const maxConcurrency = () => clampInt('EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY', 2, 1, 8);
const maxQueue = () => clampInt('EMPLOYEE_DOC_PARSE_QUEUE_MAX', 10, 0, 100);
const maxWaitMs = () => clampInt('EMPLOYEE_DOC_PARSE_WAIT_MS', 30_000, 10, 120_000);
// Variável só para teste: ignorada em produção.
const parseTimeoutMs = (fallback: number) => (process.env.NODE_ENV !== 'production' && process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS ? clampInt('EMPLOYEE_DOC_PARSE_TIMEOUT_MS', fallback, 50, 60_000) : fallback);

const tenantConcurrency = () => clampInt('EMPLOYEE_DOC_PARSE_TENANT_CONCURRENCY', 1, 1, 8);
const tenantQueueMax = () => clampInt('EMPLOYEE_DOC_PARSE_TENANT_QUEUE_MAX', 2, 0, 100);

interface Waiter { tenant: string | null; grant: () => void; timer: NodeJS.Timeout }
let running = 0;
const runningByTenant = new Map<string, number>();
const queue: Waiter[] = [];
export const docParseSnapshot = () => ({ running, queued: queue.length });

const bump = (tenant: string | null, d: number) => {
  if (tenant === null) return;
  const n = (runningByTenant.get(tenant) ?? 0) + d;
  if (n <= 0) runningByTenant.delete(tenant);
  else runningByTenant.set(tenant, n);
};
const tenantFree = (tenant: string | null) => tenant === null || (runningByTenant.get(tenant) ?? 0) < tenantConcurrency();

function makeRelease(tenant: string | null): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    running--;
    bump(tenant, -1);
    // Concede a quem estiver elegível na ordem da fila (um tenant no limite não bloqueia os outros).
    for (let i = 0; i < queue.length && running < maxConcurrency();) {
      const w = queue[i];
      if (!tenantFree(w.tenant)) { i++; continue; }
      queue.splice(i, 1);
      clearTimeout(w.timer);
      w.grant();
    }
  };
}

// `tenantId` ausente = sem cota por empresa (só os limites globais).
function acquire(tenantId?: string): Promise<(() => void) | 'full' | 'timeout'> {
  const tenant = tenantId ?? null;
  if (running < maxConcurrency() && tenantFree(tenant)) {
    running++;
    bump(tenant, 1);
    return Promise.resolve(makeRelease(tenant));
  }
  if (queue.length >= maxQueue()) return Promise.resolve('full');
  if (tenant !== null && queue.filter((w) => w.tenant === tenant).length >= tenantQueueMax()) return Promise.resolve('full');
  return new Promise((resolve) => {
    const w: Waiter = {
      tenant,
      grant: () => { running++; bump(tenant, 1); resolve(makeRelease(tenant)); },
      timer: setTimeout(() => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        resolve('timeout');
      }, maxWaitMs()),
    };
    queue.push(w);
  });
}

// A permissão é sempre devolvida (finally), inclusive em timeout, terminate e exceção.
async function withPermit(tenantId: string | undefined, work: () => Promise<BoundedText>): Promise<BoundedText> {
  const permit = await acquire(tenantId);
  if (typeof permit !== 'function') return { status: 'erro', detail: BUSY_DETAIL };
  try {
    return await work();
  } finally {
    permit();
  }
}

// Mede o tamanho inflado das entradas (em fluxo, com teto) sem materializar o conteúdo.
async function docxWithinLimits(buffer: Buffer): Promise<boolean> {
  const parsed = parseZipDirectory(buffer, { maxEntries: DOCX_MAX_ENTRIES, maxEntryBytes: DOCX_MAX_TOTAL, maxTotalBytes: DOCX_MAX_TOTAL });
  if (!parsed.ok) return false;
  let total = 0;
  for (const entry of parsed.entries) {
    if (entry.encrypted) return false;
    const data = entryData(buffer, entry);
    if (!data) return false;
    const isXml = /\.(xml|rels)$/i.test(entry.name);
    const cap = entry.name === 'word/document.xml' ? DOCX_MAX_DOCUMENT_XML : isXml ? DOCX_MAX_OTHER_XML : DOCX_MAX_TOTAL - total;
    let size: number;
    if (entry.method === 0) size = data.length;
    else if (entry.method === 8) {
      try {
        size = await inflatedSizeUpTo(data, Math.min(cap, DOCX_MAX_TOTAL - total));
      } catch {
        return false;
      }
    } else return false;
    if (size < 0 || size > cap) return false;
    total += size;
    if (total > DOCX_MAX_TOTAL) return false;
  }
  return true;
}

// O mammoth e o pdf.js rodam NA THREAD PRINCIPAL quando chamados direto (medido: segundos de loop travado e GBs de RSS, e o
// timer de timeout só dispara quando o loop libera). Por isso cada leitura roda numa worker thread própria, com teto de
// heap e `terminate()` no tempo limite: o loop da API nunca fica refém de um arquivo malicioso, e a leitura não continua
// em segundo plano depois que a permissão do semáforo é devolvida.
// Código inline (eval) para não depender de arquivo .js extra no build; o módulo é resolvido pelo caminho absoluto.
const PDF_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
(async () => {
  const { PDFParse } = require(workerData.mod);
  const parser = new PDFParse({ data: Buffer.from(workerData.data) });
  try {
    const r = await parser.getText({ first: workerData.pages, pageJoiner: '' });
    parentPort.postMessage({ ok: true, text: String(r.text).slice(0, workerData.maxChars + 1), total: r.total });
  } catch (e) {
    parentPort.postMessage({ ok: false, name: (e && e.name) || 'Error' });
  } finally {
    await parser.destroy().catch(() => {});
  }
})();
`;
const DOCX_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
(async () => {
  try {
    const mammoth = require(workerData.mod);
    const r = await mammoth.extractRawText({ buffer: Buffer.from(workerData.data) });
    parentPort.postMessage({ ok: true, text: String(r.value).slice(0, workerData.maxChars + 1) });
  } catch (e) {
    parentPort.postMessage({ ok: false, name: (e && e.name) || 'Error' });
  }
})();
`;

// Opções comuns dos workers. env vazio: o worker não herda chaves nem segredos do processo (só lê o buffer que recebe).
// Exportada para o teste criar um worker de sonda com EXATAMENTE as mesmas opções.
export const WORKER_COMMON_OPTIONS = {
  env: {} as Record<string, string>,
  resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 64 },
};

type WorkerOutcome = { ok: true; text: string; total?: number } | { ok: false; name: string } | 'timeout' | 'crash';

function runWorker(code: string, mod: string, buffer: Buffer, timeoutMs: number): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(code, {
      eval: true,
      workerData: { mod, data: new Uint8Array(buffer), pages: PDF_MAX_PAGES, maxChars: MAX_TEXT_CHARS },
      ...WORKER_COMMON_OPTIONS,
    });
    const finish = (out: WorkerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Já respondeu, estourou ou caiu: garante que a thread não sobra (terminate é idempotente).
      void worker.terminate().catch(() => undefined);
      resolve(out);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    worker.once('message', (m) => finish(m as WorkerOutcome));
    worker.once('error', () => finish('crash')); // inclui ERR_WORKER_OUT_OF_MEMORY
    worker.once('exit', () => finish('crash'));
  });
}

async function docxText(buffer: Buffer, tenantId?: string): Promise<BoundedText> {
  // O pré-teste é barato e roda fora do semáforo: a bomba barrada nunca ocupa permissão.
  if (!(await docxWithinLimits(buffer))) return ilegivel(TOO_BIG_DETAIL);
  return withPermit(tenantId, async () => {
    const out = await runWorker(DOCX_WORKER_CODE, require.resolve('mammoth'), buffer, parseTimeoutMs(DOCX_TIMEOUT_MS));
    if (out === 'timeout' || out === 'crash') {
      logger.warn(`Leitura de DOCX do cadastro interrompida: ${out}`);
      return ilegivel(TOO_BIG_DETAIL);
    }
    if (!out.ok) {
      logger.warn(`Falha ao ler DOCX do cadastro: ${out.name}`);
      return ilegivel(NO_TEXT_DETAIL);
    }
    const text = out.text.trim();
    return text === '' ? ilegivel(EMPTY_DOCX_DETAIL) : { status: 'ok', text: text.slice(0, MAX_TEXT_CHARS) };
  });
}

// `/Encrypt` só vale no dicionário do trailer (ou do fluxo de referência cruzada), que fica no final do arquivo; um
// texto qualquer com essa palavra no meio do PDF não o torna ilegível. Limite: trailer fora dos últimos 4 KB cai no
// erro de senha do próprio leitor (tratado abaixo).
const PDF_TAIL_BYTES = 4096;

async function pdfText(buffer: Buffer, tenantId?: string): Promise<BoundedText> {
  if (buffer.subarray(Math.max(0, buffer.length - PDF_TAIL_BYTES)).includes('/Encrypt')) return ilegivel(ENCRYPTED_DETAIL);
  return withPermit(tenantId, async () => {
    const out = await runWorker(PDF_WORKER_CODE, require.resolve('pdf-parse'), buffer, parseTimeoutMs(PDF_TIMEOUT_MS));
    if (out === 'timeout' || out === 'crash') {
      logger.warn(`Leitura de PDF do cadastro interrompida: ${out}`);
      return ilegivel(TOO_BIG_DETAIL);
    }
    if (!out.ok) {
      logger.warn(`Falha ao ler PDF do cadastro: ${out.name}`);
      return ilegivel(/password/i.test(out.name) ? ENCRYPTED_DETAIL : NO_TEXT_DETAIL);
    }
    const text = out.text.trim();
    if (text === '') return ilegivel(NO_TEXT_DETAIL);
    return { status: 'ok', text: text.slice(0, MAX_TEXT_CHARS), ...((out.total ?? 0) > PDF_MAX_PAGES ? { detail: PDF_PAGES_DETAIL } : {}) };
  });
}

export async function extractBoundedText(mimeType: string, buffer: Buffer, tenantId?: string): Promise<BoundedText> {
  if (mimeType === 'application/pdf') return pdfText(buffer, tenantId);
  if (mimeType === DOCX_MIME_TYPE) return docxText(buffer, tenantId);
  return ilegivel('Esse tipo de arquivo ainda não é lido para o cadastro.');
}
