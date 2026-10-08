# Monitor normativo — gerir fontes pela tela (fatia 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin edita, desativa e reativa fontes normativas, verifica uma fonte na hora e testa uma URL antes de salvar, tudo pela tela `/admin/normativa`, com uma guarda contra SSRF em todo acesso a URL externa.

**Architecture:** Uma guarda pura (`common/url/public-url.util.ts`: `assertPublicUrl`, `fetchPublic`, `readBodyCapped`) usada pelo monitor (noturno e sob demanda) e pelos endpoints novos. `NormativeMonitorService` ganha `fetchAndExtract`, `checkSource` e `previewUrl`. `OfficialSourcesService`/`Controller` ganham `update`, `findByUrl`, `PATCH :id`, `POST :id/check-now` e `POST preview`. No frontend, o cartão "Fontes monitoradas" sai de `page.tsx` para `normativa/FontesPanel.tsx` (tabela com ações e pré-visualização).

**Tech Stack:** NestJS, TypeScript, pg, jest; Next.js 14, React 18, Tailwind v4, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-08-monitor-normativo-gerir-fontes-design.md`

## Global Constraints

- **Sem migration**, sem variável de ambiente nova, sem dependência nova (`package.json` não muda), sem mudança de Docker/Nginx/RLS.
- Comandos do backend em `/opt/Montese/backend`; do frontend em `/opt/Montese/frontend`. Sempre com `timeout`.
- **Sem `git commit`, `push`, `add`, `reset`, `revert`, `stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes (`backend/src/pente-fino/*`, `docker-compose.yml`, `PenteFinoPanel*`, docs de eSocial): **nunca** `git add -A`, **nunca** tocar neles.
- **e2e (jest-e2e) usam banco: não rodar neste shell.** Nunca apontar nada para o Postgres de produção. Leituras de produção podem ser bloqueadas pelo classificador do Claude Code: se forem, **parar e reportar**, não contornar.
- **Nenhuma ação aprova ou publica norma**; "Verificar agora" só pode criar um pendente, como o cron. A validação humana não muda.
- A guarda **não** bloqueia quando o DNS falha (a conexão também falharia) — decisão de projeto para os testes existentes continuarem válidos; só bloqueia quando a resolução tem sucesso e devolve endereço não público.
- Os testes unitários **não podem depender de rede nem de DNS real**: injetar o resolvedor ou usar `jest.mock('dns/promises')`.
- Os testes existentes do monitor (`normative-monitor-guard.unit-spec.ts`, `normative-record-detected-version.unit-spec.ts`, `normative-text.unit-spec.ts`) devem continuar passando; a única edição permitida neles é acrescentar `jest.mock('dns/promises', …)` no topo do guard spec (Task 2).
- Suíte unitária do backend: **8 suítes já falham no HEAD limpo** (`company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`). A comparação confiável é **HEAD limpo + só esta fatia vs HEAD limpo** (mesmo conjunto de falhas); na árvore de trabalho o conjunto oscila por WIP alheio.
- Frontend: testes de página com router **estável** (`const router = vi.hoisted(() => ({ push: vi.fn() }))`), regras de convenção do admin (`adm-*` sem `rounded/bg/border/padding/fonte/cor` indevidos), tema escuro mantido.
- Comentários em PT-BR, curtos. Resposta final aos humanos em PT-BR com VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/common/url/public-url.util.ts` | criar | `UnsafeUrlError`, `isPublicIp`, `assertPublicUrl`, `fetchPublic`, `readBodyCapped` |
| `backend/test/public-url.unit-spec.ts` | criar | Testes da guarda |
| `backend/src/normative/normative-monitor.service.ts` | modificar | `fetchAndExtract`, `checkSource`, `previewUrl`; `processSource` usa a guarda |
| `backend/test/normative-monitor-sources.unit-spec.ts` | criar | Testes de `checkSource`/`previewUrl`/guarda no monitor |
| `backend/test/normative-monitor-guard.unit-spec.ts` | modificar (só o topo) | `jest.mock('dns/promises')` |
| `backend/src/normative/dto/create-official-source.dto.ts` | modificar | `@IsUrl` só http/https |
| `backend/src/normative/dto/update-official-source.dto.ts` | criar | DTO do PATCH |
| `backend/src/normative/dto/preview-source.dto.ts` | criar | DTO do preview |
| `backend/src/normative/official-sources.service.ts` | modificar | `findOne`, `update`, `findByUrl` |
| `backend/src/normative/official-sources.controller.ts` | modificar | `PATCH :id`, `POST :id/check-now`, `POST preview`, guarda no `POST` |
| `backend/test/official-sources.unit-spec.ts` | criar | Serviço (cliente falso), controller (`req` falso), DTOs |
| `frontend/src/app/admin/normativa/api.ts` | criar | `authHeaders` |
| `frontend/src/app/admin/normativa/FontesPanel.tsx` | criar | Cartão "Fontes monitoradas" |
| `frontend/src/app/admin/normativa/page.tsx` | modificar | Usa `FontesPanel`; remove o estado/handler de cadastro |
| `frontend/src/app/admin/__tests__/normativa-fontes.test.tsx` | criar | Testes do painel |
| `frontend/src/app/admin/__tests__/convencoes-paginas.test.ts` | modificar (só `PAGINAS`) | Inclui `normativa/FontesPanel.tsx` |

---

### Task 1: Guarda contra SSRF (`public-url.util.ts`)

**Files:**
- Create: `backend/src/common/url/public-url.util.ts`
- Test: `backend/test/public-url.unit-spec.ts`

**Interfaces:**
- Produces:
  - `class UnsafeUrlError extends Error`
  - `type Lookup = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>`
  - `isPublicIp(ip: string): boolean`
  - `assertPublicUrl(raw: string, lookup?: Lookup): Promise<URL>` — lança `UnsafeUrlError`
  - `fetchPublic(raw: string, init?: RequestInit, deps?: { lookup?: Lookup; fetchImpl?: typeof fetch }): Promise<{ response: Response; finalUrl: string }>`
  - `readBodyCapped(response: Response, maxBytes: number): Promise<Buffer>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import {
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublic,
  isPublicIp,
  readBodyCapped,
} from '../src/common/url/public-url.util';

const publico = async () => [{ address: '200.10.10.10', family: 4 }];

describe('isPublicIp', () => {
  it.each([
    '8.8.8.8',
    '200.10.10.10',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s é público', (ip) => expect(isPublicIp(ip)).toBe(true));

  it.each([
    '0.0.0.0',
    '10.0.0.5',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.2.10',
    '198.18.0.1',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::1',
    '2001:db8::1',
    'não é ip',
  ])('%s NÃO é público', (ip) => expect(isPublicIp(ip)).toBe(false));

  it('limites das faixas privadas de 172 e 100', () => {
    expect(isPublicIp('172.15.0.1')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true);
    expect(isPublicIp('100.63.0.1')).toBe(true);
    expect(isPublicIp('100.128.0.1')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('aceita uma URL https pública (DNS devolve IP público)', async () => {
    const url = await assertPublicUrl('https://www.planalto.gov.br/ccivil_03/leis/l8213cons.htm', publico);
    expect(url.hostname).toBe('www.planalto.gov.br');
  });

  it.each([
    ['ftp://exemplo.gov.br/x', /http/],
    ['file:///etc/passwd', /http/],
    ['http://user:senha@exemplo.gov.br/', /usuário e senha/],
    ['https://exemplo.gov.br:8443/x', /portas 80 e 443/],
    ['http://localhost/x', /interno/],
    ['http://backend:4000/health', /interno/],
    ['http://montese_postgres:5432/', /interno/],
    ['http://meu-servidor.local/x', /interno/],
    ['http://servico.internal/x', /interno/],
    ['http://127.0.0.1/x', /não público/],
    ['http://127.1/x', /não público/],
    ['http://2130706433/x', /não público/],
    ['http://0x7f000001/x', /não público/],
    ['http://10.0.0.5/x', /não público/],
    ['http://169.254.169.254/latest/meta-data/', /não público/],
    ['http://[::1]/x', /não público/],
    ['http://[::ffff:127.0.0.1]/x', /não público/],
    ['não é url', /inválida/],
  ])('bloqueia %s', async (raw, mensagem) => {
    await expect(assertPublicUrl(raw, publico)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl(raw, publico)).rejects.toThrow(mensagem);
  });

  it('bloqueia host cujo DNS resolve para a rede interna', async () => {
    const interno = async () => [{ address: '10.1.2.3', family: 4 }];
    await expect(assertPublicUrl('https://parece-publico.exemplo.com.br/', interno)).rejects.toThrow(/rede interna/);
  });

  it('bloqueia se QUALQUER endereço resolvido for não público', async () => {
    const misto = async () => [
      { address: '200.10.10.10', family: 4 },
      { address: '192.168.0.9', family: 4 },
    ];
    await expect(assertPublicUrl('https://misto.exemplo.com.br/', misto)).rejects.toThrow(/rede interna/);
  });

  it('se o DNS falhar, deixa passar (a conexão também falharia)', async () => {
    const falha = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicUrl('https://nao-existe.exemplo.com.br/', falha)).resolves.toBeInstanceOf(URL);
  });
});

describe('fetchPublic', () => {
  const resposta = (status: number, headers: Record<string, string> = {}, corpo = 'ok') =>
    new Response(corpo, { status, headers });

  it('pede redirect: manual e devolve a resposta final', async () => {
    const fetchImpl = jest.fn(async () => resposta(200));
    const { response, finalUrl } = await fetchPublic('https://exemplo.gov.br/a', { headers: { 'X-Teste': '1' } }, { lookup: publico, fetchImpl });
    expect(response.status).toBe(200);
    expect(finalUrl).toBe('https://exemplo.gov.br/a');
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.redirect).toBe('manual');
    expect(init.headers['X-Teste']).toBe('1');
  });

  it('segue redirecionamento para destino público, resolvendo URL relativa', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta(302, { location: '/novo/caminho' }))
      .mockResolvedValueOnce(resposta(200));
    const { finalUrl } = await fetchPublic('https://exemplo.gov.br/velho', {}, { lookup: publico, fetchImpl });
    expect(finalUrl).toBe('https://exemplo.gov.br/novo/caminho');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('BLOQUEIA redirecionamento para a rede interna (revalida cada salto)', async () => {
    const fetchImpl = jest.fn(async () => resposta(302, { location: 'http://169.254.169.254/latest/meta-data/' }));
    await expect(fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl })).rejects.toThrow(/não público/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('para depois de 5 redirecionamentos', async () => {
    const fetchImpl = jest.fn(async () => resposta(301, { location: 'https://exemplo.gov.br/de-novo' }));
    await expect(fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl })).rejects.toThrow(/Redirecionamentos demais/);
  });

  it('3xx sem Location é devolvido como resposta final', async () => {
    const fetchImpl = jest.fn(async () => resposta(304));
    const { response } = await fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl });
    expect(response.status).toBe(304);
  });
});

describe('readBodyCapped', () => {
  it('lê o corpo inteiro quando cabe no limite', async () => {
    const buf = await readBodyCapped(new Response('olá mundo'), 1024);
    expect(buf.toString('utf8')).toBe('olá mundo');
  });

  it('recusa pelo Content-Length declarado', async () => {
    const r = new Response('x', { headers: { 'content-length': '5000' } });
    await expect(readBodyCapped(r, 1000)).rejects.toThrow(/maior que o limite/);
  });

  it('recusa quando o corpo real passa do limite (sem Content-Length)', async () => {
    await expect(readBodyCapped(new Response('a'.repeat(2000)), 1000)).rejects.toThrow(/maior que o limite/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && timeout 180 npx jest --config ./test/jest-unit.json public-url`
Expected: FAIL (`Cannot find module '../src/common/url/public-url.util'`).

- [ ] **Step 3: Implementar**

```ts
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';

// Guarda contra SSRF para todo acesso a URL externa cadastrada por um admin (monitor das fontes
// normativas, "Verificar agora" e pré-visualização). Funções puras/injetáveis, testáveis sem rede.

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export type Lookup = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;

const PORTAS_PERMITIDAS = new Set(['', '80', '443']);
const MAX_REDIRECTS = 5;

function ipv4EhPublico(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local e metadados de nuvem
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false; // documentação
  if (a === 203 && b === 0 && c === 113) return false; // documentação
  if (a >= 224) return false; // multicast e reservados
  return true;
}

function ipv6EhPublico(ip: string): boolean {
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapeado) return ipv4EhPublico(mapeado[1]);
  const mapeadoHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapeadoHex) {
    const alto = parseInt(mapeadoHex[1], 16);
    const baixo = parseInt(mapeadoHex[2], 16);
    return ipv4EhPublico(`${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`);
  }
  if (v6 === '::' || v6 === '::1') return false;
  if (/^f[cd]/.test(v6)) return false; // fc00::/7
  if (/^fe[89ab]/.test(v6)) return false; // fe80::/10
  if (/^ff/.test(v6)) return false; // multicast
  if (v6.startsWith('64:ff9b:')) return false; // NAT64
  if (v6.startsWith('2001:db8')) return false; // documentação
  return true;
}

export function isPublicIp(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, '');
  const versao = isIP(limpo);
  if (versao === 4) return ipv4EhPublico(limpo);
  if (versao === 6) return ipv6EhPublico(limpo);
  return false;
}

export async function assertPublicUrl(raw: string, lookup: Lookup = dnsLookup as Lookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('A URL deve usar http ou https');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('A URL não pode conter usuário e senha');
  }
  if (!PORTAS_PERMITIDAS.has(url.port)) {
    throw new UnsafeUrlError('A URL só pode usar as portas 80 e 443');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError('A URL aponta para um endereço não público');
    return url;
  }
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('A URL aponta para um nome de host interno');
  }

  let enderecos: { address: string }[];
  try {
    enderecos = await lookup(host, { all: true });
  } catch {
    return url; // DNS falhou: a conexão também falhará
  }
  if (enderecos.some((e) => !isPublicIp(e.address))) {
    throw new UnsafeUrlError('O endereço da URL resolve para a rede interna');
  }
  return url;
}

// Segue redirecionamentos à mão, revalidando cada destino (um 302 para http://169.254.169.254 não passa).
export async function fetchPublic(
  raw: string,
  init: RequestInit = {},
  deps: { lookup?: Lookup; fetchImpl?: typeof fetch } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let atual = raw;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    const url = await assertPublicUrl(atual, deps.lookup);
    const response = await fetchImpl(url.toString(), { ...init, redirect: 'manual' });
    const destino = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && destino) {
      atual = new URL(destino, url).toString();
      continue;
    }
    return { response, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError('Redirecionamentos demais');
}

export async function readBodyCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const mensagem = `Fonte maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`;
  const declarado = Number(response.headers.get('content-length') ?? 0);
  if (declarado > maxBytes) throw new Error(mensagem);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(mensagem);
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json public-url && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` limpo. Se um caso de IP ou URL falhar, corrigir a **implementação** (não afrouxar o teste): `http://127.1/`, `http://2130706433/` e `http://0x7f000001/` dependem de o `URL` do Node normalizar para `127.0.0.1`; confirme com `node -e "console.log(new URL('http://127.1/x').hostname)"`.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short src/common/url test | grep -i public-url`
Expected: os 2 arquivos novos como `??`.

---

### Task 2: Monitor — `fetchAndExtract`, `checkSource` e `previewUrl`

**Files:**
- Modify: `backend/src/normative/normative-monitor.service.ts`
- Modify: `backend/test/normative-monitor-guard.unit-spec.ts` (só acrescentar o `jest.mock` no topo)
- Create: `backend/test/normative-monitor-sources.unit-spec.ts`

**Interfaces:**
- Consumes: `fetchPublic`, `readBodyCapped`, `UnsafeUrlError` (Task 1); `MONITOR_FETCH_HEADERS`, `decodeHtmlBuffer`, `meaningfulLength`, `suspiciousExtractionReason` (fatia 1).
- Produces:
  - `NormativeMonitorService.fetchAndExtract(url: string): Promise<{ text: string; mimeType: string; buffer: Buffer; statusCode: number }>`
  - `NormativeMonitorService.checkSource(sourceId: string): Promise<{ outcome: 'nova_versao' | 'sem_mudanca' | 'erro'; message: string }>` — `NotFoundException` se a fonte não existe; **sem e-mail**
  - `NormativeMonitorService.previewUrl(url: string): Promise<SourcePreview>` onde  
    `type SourcePreview = { ok: true; status_code: number; mime_type: string; chars: number; meaningful_chars: number; sample: string; suspicious: string | null } | { ok: false; message: string }`
  - `processSource` mantém a assinatura `(sourceId, url): Promise<boolean>` e passa a usar `fetchAndExtract`.

- [ ] **Step 1: Escrever o teste que falha** (`test/normative-monitor-sources.unit-spec.ts`)

```ts
import { NotFoundException } from '@nestjs/common';

// Sem rede: o DNS é simulado (host público). A guarda deve funcionar sem depender do DNS real.
jest.mock('dns/promises', () => ({
  lookup: jest.fn(async (host: string) =>
    host === 'interno.exemplo.com.br' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '200.10.10.10', family: 4 }],
  ),
}));

import { NormativeMonitorService } from '../src/normative/normative-monitor.service';

const PAGINA = `<html><body><div id="content-core">${'Texto da norma regulamentadora. '.repeat(20)}</div></body></html>`;

function montar(opcoes: { fonte?: { id: string; code: string | null; title: string; official_url: string } | null; vigenteChars?: number | null; recorded?: any } = {}) {
  const fonte = opcoes.fonte === undefined ? { id: 's1', code: 'NR-06', title: 'EPI', official_url: 'https://exemplo.gov.br/nr06.htm' } : opcoes.fonte;
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM official_sources')) return { rows: fonte ? [fonte] : [] };
      if (sql.includes('length(raw_text)')) return { rows: opcoes.vigenteChars == null ? [] : [{ len: opcoes.vigenteChars }] };
      if (sql.includes("last_check_status = 'erro'")) return { rows: [{ consecutive_failures: 1 }] };
      return { rows: [] };
    }),
  };
  const db: any = { withoutTenantContext: jest.fn(async (cb: any) => cb(client)) };
  const documents: any = { recordDetectedVersion: jest.fn(async () => (opcoes.recorded === undefined ? null : opcoes.recorded)) };
  const email: any = { send: jest.fn(async () => undefined) };
  const service = new NormativeMonitorService(db, documents, email);
  const falhas = () => consultas.filter((c) => c.sql.includes("last_check_status = 'erro'"));
  const sucessos = () => consultas.filter((c) => c.sql.includes("last_check_status = 'ok'"));
  return { service, documents, email, falhas, sucessos };
}

const servir = (html: string, init: ResponseInit = { status: 200, headers: { 'content-type': 'text/html' } }) =>
  jest.spyOn(global, 'fetch' as any).mockImplementation(async () => new Response(html, init) as any);

describe('NormativeMonitorService.checkSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fonte inexistente: NotFoundException', async () => {
    servir(PAGINA);
    const { service } = montar({ fonte: null });
    await expect(service.checkSource('nao-existe')).rejects.toThrow(NotFoundException);
  });

  it('versão nova: outcome nova_versao, marca ok e NÃO envia e-mail', async () => {
    servir(PAGINA);
    const { service, email, sucessos, falhas } = montar({ recorded: { id: 'd1' } });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('nova_versao');
    expect(r.message).toMatch(/Aguardando validação/);
    expect(sucessos()).toHaveLength(1);
    expect(falhas()).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sem versão criada: mensagem honesta (sem mudança relevante OU já há uma aguardando revisão)', async () => {
    servir(PAGINA);
    const { service } = montar({ recorded: null });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('sem_mudanca');
    expect(r.message).toMatch(/sem mudança relevante ou já há uma versão aguardando revisão/);
  });

  it('erro de HTTP: outcome erro, grava a falha e devolve a mensagem', async () => {
    servir('', { status: 500 });
    const { service, falhas, documents } = montar();
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/status 500/);
    expect(falhas()).toHaveLength(1);
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('extração suspeita (texto minúsculo): outcome erro com "Conteúdo suspeito"', async () => {
    servir('<html><body>curto</body></html>');
    const { service, documents } = montar({ vigenteChars: 35754 });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/Conteúdo suspeito/);
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('URL que resolve para a rede interna é bloqueada pela guarda (e conta como falha)', async () => {
    const fetchSpy = servir(PAGINA);
    const { service, falhas } = montar({ fonte: { id: 's1', code: null, title: 'X', official_url: 'https://interno.exemplo.com.br/x' } });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/rede interna/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(falhas()).toHaveLength(1);
  });
});

describe('NormativeMonitorService.previewUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  it('página boa: devolve métricas e uma amostra, sem gravar nada', async () => {
    servir(PAGINA);
    const { service, documents } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/nr06.htm');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status_code).toBe(200);
      expect(r.mime_type).toBe('text/html');
      expect(r.chars).toBeGreaterThan(500);
      expect(r.meaningful_chars).toBe(r.chars);
      expect(r.sample.length).toBeLessThanOrEqual(400);
      expect(r.sample).toContain('Texto da norma');
      expect(r.suspicious).toBeNull();
    }
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('página vazia: ok mas marcada como suspeita', async () => {
    servir('<html><body>curto</body></html>');
    const { service } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/vazia.htm');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.suspicious).toMatch(/Conteúdo suspeito/);
  });

  it('falha de rede/HTTP: ok false com a mensagem', async () => {
    servir('', { status: 403 });
    const { service } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/bloqueada.htm');
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/status 403/) });
  });

  it('URL interna: ok false, sem fazer nenhuma requisição', async () => {
    const fetchSpy = servir(PAGINA);
    const { service } = montar();
    const r = await service.previewUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

Acrescentar no **topo** de `test/normative-monitor-guard.unit-spec.ts` (antes do `import { NormativeMonitorService }`), sem tocar em mais nada:

```ts
// Sem rede: a guarda de URL consulta o DNS; aqui ele devolve sempre um IP público.
jest.mock('dns/promises', () => ({ lookup: jest.fn(async () => [{ address: '200.10.10.10', family: 4 }]) }));
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && timeout 180 npx jest --config ./test/jest-unit.json normative-monitor-sources`
Expected: FAIL (`checkSource`/`previewUrl`/`fetchAndExtract` não existem).

- [ ] **Step 3: Implementar**

Em `normative-monitor.service.ts`:

1. Imports (acrescentar/ajustar):
```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { fetchPublic, readBodyCapped } from '../common/url/public-url.util';
```
(manter os demais imports, inclusive `MONITOR_FETCH_HEADERS`, `decodeHtmlBuffer`, `meaningfulLength`, `suspiciousExtractionReason`.)

2. Tipos e constante, logo antes de `@Injectable()`:
```ts
const MAX_FONTE_BYTES = 25 * 1024 * 1024;

export interface ExtractedPage {
  text: string;
  mimeType: string;
  buffer: Buffer;
  statusCode: number;
}

export interface CheckOutcome {
  outcome: 'nova_versao' | 'sem_mudanca' | 'erro';
  message: string;
}

export type SourcePreview =
  | { ok: true; status_code: number; mime_type: string; chars: number; meaningful_chars: number; sample: string; suspicious: string | null }
  | { ok: false; message: string };
```

3. Substituir **todo o método `processSource`** por estes três métodos (o ramo PDF/HTML é exatamente o de hoje, só movido):
```ts
  // Busca (pela guarda de URL, com limite de tamanho) e extrai o texto. Usado pelo cron, por
  // "Verificar agora" e pela pré-visualização.
  async fetchAndExtract(url: string): Promise<ExtractedPage> {
    const { response } = await fetchPublic(url, { headers: MONITOR_FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Fonte respondeu status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await readBodyCapped(response, MAX_FONTE_BYTES);

    let text: string;
    let mimeType: string;
    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      // pdf-parse v2 é baseado em classe, não em função (mudança de API confirmada em 2026-08-28).
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
      mimeType = 'application/pdf';
    } else {
      text = extractHtmlText(decodeHtmlBuffer(buffer, contentType));
      mimeType = 'text/html';
    }
    return { text, mimeType, buffer, statusCode: response.status };
  }

  private async processSource(sourceId: string, url: string): Promise<boolean> {
    const { text, mimeType, buffer } = await this.fetchAndExtract(url);

    // Barreira contra extração vazia/quebrada: não vira pendente (aprovar substituiria uma norma boa por
    // lixo). Vira falha da fonte — badge vermelho na tela e e-mail na 2ª falha seguida.
    const vigenteChars = await this.db.withoutTenantContext(async (client) => {
      const { rows } = await client.query<{ len: number }>(
        `SELECT length(raw_text) AS len FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
        [sourceId],
      );
      return rows[0]?.len ?? null;
    });
    const suspeita = suspiciousExtractionReason(meaningfulLength(text), vigenteChars);
    if (suspeita) {
      throw new Error(suspeita);
    }

    const created = await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
    return created !== null;
  }

  // "Verificar agora": mesma contabilidade de sucesso/falha do cron, mas sem e-mail (o admin está olhando).
  async checkSource(sourceId: string): Promise<CheckOutcome> {
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<MonitoredSource>('SELECT id, code, title, official_url FROM official_sources WHERE id = $1', [sourceId]),
    );
    const source = rows[0];
    if (!source) throw new NotFoundException('Fonte não encontrada');

    try {
      const createdNewVersion = await this.processSource(source.id, source.official_url);
      await this.recordSuccess(source.id);
      return createdNewVersion
        ? { outcome: 'nova_versao', message: 'Nova versão detectada: veja em "Aguardando validação".' }
        : {
            outcome: 'sem_mudanca',
            message: 'Nenhuma versão nova criada (sem mudança relevante ou já há uma versão aguardando revisão).',
          };
    } catch (err) {
      const message = ((err as Error).message ?? String(err)).slice(0, LAST_ERROR_MAX_LENGTH);
      await this.recordFailure(source.id, message);
      return { outcome: 'erro', message };
    }
  }

  // Pré-visualização: lê e extrai a URL sem gravar nada, para o admin testar antes de salvar a fonte.
  async previewUrl(url: string): Promise<SourcePreview> {
    try {
      const page = await this.fetchAndExtract(url);
      const significativos = meaningfulLength(page.text);
      return {
        ok: true,
        status_code: page.statusCode,
        mime_type: page.mimeType,
        chars: page.text.length,
        meaningful_chars: significativos,
        sample: page.text.replace(/\s+/g, ' ').trim().slice(0, 400),
        suspicious: suspiciousExtractionReason(significativos, null),
      };
    } catch (err) {
      return { ok: false, message: ((err as Error).message ?? String(err)).slice(0, LAST_ERROR_MAX_LENGTH) };
    }
  }
```
`runOnce`, `recordSuccess`, `recordFailure`, `notifyAdmins` e `extractHtmlText` **não mudam**.

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-monitor-sources normative-monitor-guard normative-record-detected-version normative-text public-url && npx tsc --noEmit -p tsconfig.json`
Expected: PASS em tudo (os testes da fatia 1 sem edição, exceto o `jest.mock` no topo do guard spec); `tsc` limpo.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git diff --stat src/normative/normative-monitor.service.ts test/normative-monitor-guard.unit-spec.ts`
Expected: só esses 2 arquivos modificados nesta tarefa; no guard spec, apenas as linhas do `jest.mock`.

---

### Task 3: Fontes — serviço, DTOs e controller

**Files:**
- Modify: `backend/src/normative/dto/create-official-source.dto.ts`
- Create: `backend/src/normative/dto/update-official-source.dto.ts`, `backend/src/normative/dto/preview-source.dto.ts`
- Modify: `backend/src/normative/official-sources.service.ts`
- Modify: `backend/src/normative/official-sources.controller.ts`
- Test: `backend/test/official-sources.unit-spec.ts`

**Interfaces:**
- Consumes: `assertPublicUrl`, `UnsafeUrlError` (Task 1); `NormativeMonitorService.checkSource/previewUrl` (Task 2).
- Produces:
  - `OfficialSourcesService.findOne(client, id): Promise<OfficialSource | null>`
  - `OfficialSourcesService.update(client, id, data: UpdateOfficialSourceData): Promise<OfficialSource | null>`
  - `OfficialSourcesService.findByUrl(client, url): Promise<{ id: string; title: string; code: string | null } | null>`
  - Rotas: `PATCH /normative-sources/:id`, `POST /normative-sources/:id/check-now`, `POST /normative-sources/preview` (todas `@Roles('admin')`).

- [ ] **Step 1: Escrever o teste que falha** (`test/official-sources.unit-spec.ts`)

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

jest.mock('dns/promises', () => ({ lookup: jest.fn(async () => [{ address: '200.10.10.10', family: 4 }]) }));

import { CreateOfficialSourceDto } from '../src/normative/dto/create-official-source.dto';
import { PreviewSourceDto } from '../src/normative/dto/preview-source.dto';
import { UpdateOfficialSourceDto } from '../src/normative/dto/update-official-source.dto';
import { OfficialSourcesController } from '../src/normative/official-sources.controller';
import { OfficialSourcesService } from '../src/normative/official-sources.service';

const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

describe('DTOs de fonte', () => {
  it('cadastro exige http/https', async () => {
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'ftp://x.gov.br/a' })).toContain('official_url');
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'não é url' })).toContain('official_url');
    expect(await erros(CreateOfficialSourceDto, { entity: 'MTE', title: 'T', official_url: 'https://x.gov.br/a' })).toEqual([]);
  });

  it('edição: tudo opcional, mas o que vier é validado', async () => {
    expect(await erros(UpdateOfficialSourceDto, {})).toEqual([]);
    expect(await erros(UpdateOfficialSourceDto, { active: false })).toEqual([]);
    expect(await erros(UpdateOfficialSourceDto, { official_url: 'ftp://x/a' })).toContain('official_url');
    expect(await erros(UpdateOfficialSourceDto, { title: '' })).toContain('title');
    expect(await erros(UpdateOfficialSourceDto, { active: 'sim' })).toContain('active');
  });

  it('pré-visualização exige http/https', async () => {
    expect(await erros(PreviewSourceDto, { official_url: 'file:///etc/passwd' })).toContain('official_url');
    expect(await erros(PreviewSourceDto, { official_url: 'https://x.gov.br/a' })).toEqual([]);
  });
});

function clienteFalso(respostas: (sql: string, params: any[]) => any) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      return respostas(sql, params) ?? { rows: [] };
    }),
  };
  return { client, consultas };
}

describe('OfficialSourcesService.update', () => {
  const service = new OfficialSourcesService();
  const fonte = { id: 'f1', entity: 'MTE', code: 'NR-06', title: 'EPI', official_url: 'https://a.gov.br/x', active: true };

  it('sem campos: devolve a fonte atual sem UPDATE', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.startsWith('SELECT') ? { rows: [fonte] } : undefined));
    expect(await service.update(client, 'f1', {})).toEqual(fonte);
    expect(consultas.some((c) => c.sql.includes('UPDATE'))).toBe(false);
  });

  it('só os campos enviados entram no UPDATE; código vazio limpa (NULL)', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.includes('UPDATE') ? { rows: [fonte] } : undefined));
    await service.update(client, 'f1', { title: 'Novo', code: '  ', active: false });
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toContain('title = $2');
    expect(upd.sql).toContain('code = $3');
    expect(upd.sql).toContain('active = $4');
    expect(upd.sql).not.toContain('official_url');
    expect(upd.params).toEqual(['f1', 'Novo', null, false]);
  });

  it('trocar a URL zera o estado da última verificação (só se a URL de fato mudou)', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.includes('UPDATE') ? { rows: [fonte] } : undefined));
    await service.update(client, 'f1', { official_url: 'https://b.gov.br/y' });
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toMatch(/consecutive_failures = CASE WHEN official_url IS DISTINCT FROM \$2 THEN 0/);
    expect(upd.sql).toMatch(/last_error = CASE WHEN official_url IS DISTINCT FROM \$2 THEN NULL/);
    expect(upd.sql).toMatch(/last_check_status = CASE/);
    expect(upd.sql).toMatch(/last_checked_at = CASE/);
    expect(upd.sql).toContain('official_url = $2');
    expect(upd.params).toEqual(['f1', 'https://b.gov.br/y']);
  });

  it('fonte inexistente: devolve null', async () => {
    const { client } = clienteFalso(() => ({ rows: [] }));
    expect(await service.update(client, 'x', { title: 'a' })).toBeNull();
  });
});

describe('OfficialSourcesService.findByUrl', () => {
  it('compara a URL normalizada (minúsculas, sem # e sem barra final)', async () => {
    const service = new OfficialSourcesService();
    const { client, consultas } = clienteFalso(() => ({ rows: [{ id: 'f9', title: 'Outra', code: null }] }));
    const achou = await service.findByUrl(client, 'HTTPS://Exemplo.GOV.br/Norma/#topo');
    expect(achou).toEqual({ id: 'f9', title: 'Outra', code: null });
    expect(consultas[0].params).toEqual(['https://exemplo.gov.br/norma']);
  });
});

describe('OfficialSourcesController', () => {
  function montar() {
    const sources: any = {
      create: jest.fn(async (_c: any, dto: any) => ({ id: 'novo', ...dto })),
      update: jest.fn(async () => ({ id: 'f1', title: 'ok' })),
      findByUrl: jest.fn(async () => null),
      findAll: jest.fn(async () => []),
    };
    const monitor: any = {
      checkSource: jest.fn(async () => ({ outcome: 'sem_mudanca', message: 'm' })),
      previewUrl: jest.fn(async () => ({ ok: true, status_code: 200, mime_type: 'text/html', chars: 500, meaningful_chars: 500, sample: 's', suspicious: null })),
    };
    const req: any = { withTenantContext: (fn: any) => fn({}) };
    return { controller: new OfficialSourcesController(sources, monitor), sources, monitor, req };
  }
  const ID = '123e4567-e89b-42d3-a456-426614174000';

  it('POST: bloqueia URL interna ANTES de gravar (400)', async () => {
    const { controller, sources, req } = montar();
    await expect(controller.create({ entity: 'MTE', title: 'T', official_url: 'http://127.0.0.1/x' } as any, req)).rejects.toThrow(BadRequestException);
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('POST: URL pública grava normalmente', async () => {
    const { controller, sources, req } = montar();
    await controller.create({ entity: 'MTE', title: 'T', official_url: 'https://www.gov.br/x' } as any, req);
    expect(sources.create).toHaveBeenCalledTimes(1);
  });

  it('PATCH: bloqueia URL interna (400) e não grava', async () => {
    const { controller, sources, req } = montar();
    await expect(controller.update(ID, { official_url: 'http://169.254.169.254/x' } as any, req)).rejects.toThrow(/não público/);
    expect(sources.update).not.toHaveBeenCalled();
  });

  it('PATCH sem URL (ex.: desativar) não consulta a guarda e grava', async () => {
    const { controller, sources, req } = montar();
    await controller.update(ID, { active: false } as any, req);
    expect(sources.update).toHaveBeenCalledWith({}, ID, { active: false });
  });

  it('PATCH de fonte inexistente: 404', async () => {
    const { controller, sources, req } = montar();
    sources.update.mockResolvedValue(null);
    await expect(controller.update(ID, { active: true } as any, req)).rejects.toThrow(NotFoundException);
  });

  it('check-now delega ao monitor', async () => {
    const { controller, monitor } = montar();
    expect(await controller.checkNow(ID)).toEqual({ outcome: 'sem_mudanca', message: 'm' });
    expect(monitor.checkSource).toHaveBeenCalledWith(ID);
  });

  it('preview devolve o resultado do monitor + a fonte duplicada, se houver', async () => {
    const { controller, sources, monitor, req } = montar();
    sources.findByUrl.mockResolvedValue({ id: 'f2', title: 'Já existe', code: 'NR-06' });
    const r: any = await controller.preview({ official_url: 'https://www.gov.br/x' } as any, req);
    expect(monitor.previewUrl).toHaveBeenCalledWith('https://www.gov.br/x');
    expect(r.ok).toBe(true);
    expect(r.duplicate_of).toEqual({ id: 'f2', title: 'Já existe', code: 'NR-06' });
  });

  it('preview de URL interna: 400 e nenhuma leitura', async () => {
    const { controller, monitor, req } = montar();
    await expect(controller.preview({ official_url: 'http://localhost/x' } as any, req)).rejects.toThrow(BadRequestException);
    expect(monitor.previewUrl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json official-sources`
Expected: FAIL (DTOs, `update`, `findByUrl`, rotas inexistentes).

- [ ] **Step 3: Implementar — DTOs**

`dto/create-official-source.dto.ts`: trocar `@IsUrl()` por `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` (o resto igual).

`dto/update-official-source.dto.ts`:
```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

// Todos os campos são opcionais; o que vier é validado como no cadastro.
export class UpdateOfficialSourceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  entity?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  official_url?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`dto/preview-source.dto.ts`:
```ts
import { IsUrl } from 'class-validator';

export class PreviewSourceDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  official_url: string;
}
```

- [ ] **Step 4: Implementar — serviço**

Em `official-sources.service.ts`, acrescentar (mantendo `create` e `findAll`):
```ts
interface UpdateOfficialSourceData {
  entity?: string;
  code?: string;
  title?: string;
  official_url?: string;
  active?: boolean;
}

// URL normalizada para achar fontes duplicadas: minúsculas, sem #fragmento e sem barra final.
function normalizarUrl(url: string): string {
  return url.trim().split('#')[0].replace(/\/+$/, '').toLowerCase();
}
```
e os métodos na classe:
```ts
  async findOne(client: PoolClient, id: string): Promise<OfficialSource | null> {
    const result = await client.query<OfficialSource>('SELECT * FROM official_sources WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async update(client: PoolClient, id: string, data: UpdateOfficialSourceData): Promise<OfficialSource | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (coluna: string, valor: unknown) => {
      params.push(valor);
      sets.push(`${coluna} = $${params.length}`);
    };
    if (data.entity !== undefined) add('entity', data.entity);
    if (data.code !== undefined) add('code', data.code.trim() === '' ? null : data.code);
    if (data.title !== undefined) add('title', data.title);
    if (data.active !== undefined) add('active', data.active);
    if (data.official_url !== undefined) {
      params.push(data.official_url);
      const n = params.length;
      // Trocar a URL zera o estado da última verificação (era de outra página). No UPDATE, o lado
      // direito vê a linha ANTIGA, então o CASE compara a URL de antes com a nova.
      sets.push(
        `last_check_status = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_check_status END`,
        `last_checked_at = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_checked_at END`,
        `last_error = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_error END`,
        `consecutive_failures = CASE WHEN official_url IS DISTINCT FROM $${n} THEN 0 ELSE consecutive_failures END`,
        `official_url = $${n}`,
      );
    }
    if (sets.length === 0) return this.findOne(client, id);

    const result = await client.query<OfficialSource>(
      `UPDATE official_sources SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return result.rows[0] ?? null;
  }

  async findByUrl(client: PoolClient, url: string): Promise<{ id: string; title: string; code: string | null } | null> {
    const result = await client.query<{ id: string; title: string; code: string | null }>(
      `SELECT id, title, code FROM official_sources
       WHERE lower(regexp_replace(split_part(official_url, '#', 1), '/+$', '')) = $1
       LIMIT 1`,
      [normalizarUrl(url)],
    );
    return result.rows[0] ?? null;
  }
```

- [ ] **Step 5: Implementar — controller** (substituir o arquivo)

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { UnsafeUrlError, assertPublicUrl } from '../common/url/public-url.util';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeMonitorService } from './normative-monitor.service';
import { CreateOfficialSourceDto } from './dto/create-official-source.dto';
import { UpdateOfficialSourceDto } from './dto/update-official-source.dto';
import { PreviewSourceDto } from './dto/preview-source.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

// A URL cadastrada é buscada pelo servidor (monitor, "Verificar agora", pré-visualização): a guarda contra
// SSRF roda ao gravar e a cada requisição.
async function exigirUrlPublica(url: string): Promise<void> {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new BadRequestException(err.message);
    throw err;
  }
}

@Controller('normative-sources')
export class OfficialSourcesController {
  constructor(
    private readonly sources: OfficialSourcesService,
    private readonly monitor: NormativeMonitorService,
  ) {}

  @Roles('admin')
  @UsePipes(pipe)
  @Post()
  async create(@Body() dto: CreateOfficialSourceDto, @Req() req: any) {
    await exigirUrlPublica(dto.official_url);
    return req.withTenantContext((client: any) => this.sources.create(client, dto));
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.findAll(client));
  }

  // Pré-visualização: lê e extrai a URL sem gravar nada. Declarada antes das rotas com :id.
  @Roles('admin')
  @RateLimit({ limit: 30, windowSeconds: 3600, keyBy: 'ip' })
  @UsePipes(pipe)
  @Post('preview')
  async preview(@Body() dto: PreviewSourceDto, @Req() req: any) {
    await exigirUrlPublica(dto.official_url);
    const result = await this.monitor.previewUrl(dto.official_url);
    const duplicate = await req.withTenantContext((client: any) => this.sources.findByUrl(client, dto.official_url));
    return { ...result, duplicate_of: duplicate };
  }

  @Roles('admin')
  @UsePipes(pipe)
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfficialSourceDto, @Req() req: any) {
    if (dto.official_url !== undefined) await exigirUrlPublica(dto.official_url);
    const updated = await req.withTenantContext((client: any) => this.sources.update(client, id, dto));
    if (!updated) throw new NotFoundException('Fonte não encontrada');
    return updated;
  }

  @Roles('admin')
  @RateLimit({ limit: 20, windowSeconds: 3600, keyBy: 'ip' })
  @Post(':id/check-now')
  checkNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.monitor.checkSource(id);
  }
}
```
(`NormativeMonitorService` já é provider do `NormativeModule`; nenhuma mudança no módulo.)

- [ ] **Step 6: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json official-sources normative-monitor-sources public-url && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` limpo. Conferir com `grep -n "check-now\|preview\|Patch" src/normative/official-sources.controller.ts` que as 3 rotas existem e que `preview` vem antes de `:id`.

- [ ] **Step 7: Checkpoint (sem commit)**

Run: `git status --short src/normative test | grep -iE "official|dto"`
Expected: os arquivos desta tarefa; nada em `backend/src/pente-fino/*`.

---

### Task 4: Tela — `FontesPanel`

**Files:**
- Create: `frontend/src/app/admin/normativa/api.ts`, `frontend/src/app/admin/normativa/FontesPanel.tsx`
- Modify: `frontend/src/app/admin/normativa/page.tsx`
- Modify: `frontend/src/app/admin/__tests__/convencoes-paginas.test.ts` (só a lista `PAGINAS`)
- Test: `frontend/src/app/admin/__tests__/normativa-fontes.test.tsx`

**Interfaces:**
- Consumes: `POST /api/normative-sources` (existente), `PATCH /api/normative-sources/:id`, `POST /api/normative-sources/:id/check-now`, `POST /api/normative-sources/preview` (Task 3).
- Produces: `FontesPanel({ sources, onChanged })`; `OfficialSource` exportado; `authHeaders()` em `api.ts`.

- [ ] **Step 1: Escrever o teste que falha** (`normativa-fontes.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminNormativaPage from '../normativa/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const FALHA = (extra: object = {}) => ({ ok: false, json: async () => ({ message: ['URL inválida'], ...extra }) });
const agora = new Date().toISOString();

const FONTES = [
  { id: 's1', entity: 'MTE', code: 'NR-06', title: 'EPI', official_url: 'https://www.gov.br/nr06.pdf', active: true, last_checked_at: agora, last_check_status: 'ok', last_error: null, consecutive_failures: 0 },
  { id: 's2', entity: 'INSS', code: null, title: 'Portal quebrado', official_url: 'https://portal.exemplo.gov.br/', active: true, last_checked_at: agora, last_check_status: 'erro', last_error: 'timeout', consecutive_failures: 3 },
  { id: 's3', entity: 'CJF', code: 'TNU', title: 'Fonte desativada', official_url: 'https://www.cjf.jus.br/x', active: false, last_checked_at: null, last_check_status: null, last_error: null, consecutive_failures: 0 },
  { id: 's4', entity: 'MTE', code: 'NR-99', title: 'Nunca vista', official_url: 'https://www.gov.br/nr99', active: true, last_checked_at: null, last_check_status: null, last_error: null, consecutive_failures: 0 },
];

let fetchMock: ReturnType<typeof vi.fn>;
let respostas: Record<string, any>;
const chamadas = (url: string, metodo: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === metodo);
const linha = (texto: string) => screen.getByText(texto).closest('tr') as HTMLElement;

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  respostas = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    if (respostas[chave]) return respostas[chave];
    if (chave === 'GET /api/normative-sources') return ok(FONTES);
    if (chave.startsWith('GET /api/normative-documents')) return ok([]);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/normativa — Fontes monitoradas', () => {
  it('mostra uma tabela com o estado de cada fonte', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    expect(screen.getByRole('table')).toHaveClass('adm-table');
    expect(within(linha('Portal quebrado')).getByText('Falhando (3) — timeout').closest('span.rounded-full')).not.toBeNull();
    expect(within(linha('Fonte desativada')).getByText('Inativa')).toBeInTheDocument();
    expect(within(linha('Nunca vista')).getByText('Nunca verificada')).toBeInTheDocument();
    expect(within(linha('EPI')).getByText('ok')).toBeInTheDocument();
  });

  it('o filtro "só fontes com problema" esconde as saudáveis (falhando ou inativa continuam)', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(screen.getByLabelText(/Mostrar só fontes com problema/));
    expect(screen.queryByText('EPI')).toBeNull();
    expect(screen.queryByText('Nunca vista')).toBeNull();
    expect(screen.getByText('Portal quebrado')).toBeInTheDocument();
    expect(screen.getByText('Fonte desativada')).toBeInTheDocument();
  });

  it('Verificar agora: POST check-now, mostra o resultado na linha e recarrega a lista', async () => {
    respostas['POST /api/normative-sources/s2/check-now'] = ok({ outcome: 'nova_versao', message: 'Nova versão detectada: veja em "Aguardando validação".' });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    const antes = chamadas('/api/normative-sources', 'GET').length;
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Verificar agora/ }));
    expect(await screen.findByText(/Nova versão detectada/)).toBeInTheDocument();
    expect(chamadas('/api/normative-sources/s2/check-now', 'POST')).toHaveLength(1);
    await waitFor(() => expect(chamadas('/api/normative-sources', 'GET').length).toBeGreaterThan(antes));
  });

  it('Verificar agora com erro da fonte mostra a mensagem', async () => {
    respostas['POST /api/normative-sources/s2/check-now'] = ok({ outcome: 'erro', message: 'Fonte respondeu status 403' });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Verificar agora/ }));
    expect(await screen.findByText(/Falhou: Fonte respondeu status 403/)).toBeInTheDocument();
  });

  it('Desativar envia PATCH {active:false}; Reativar envia {active:true}', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s2', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s2', 'PATCH')[0][1].body)).toEqual({ active: false });
    fireEvent.click(within(linha('Fonte desativada')).getByRole('button', { name: /Reativar/ }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s3', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s3', 'PATCH')[0][1].body)).toEqual({ active: true });
  });

  it('Editar: abre o formulário preenchido e salva só com PATCH dos 4 campos', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    const url = await screen.findByLabelText('URL oficial (edição)');
    expect(url).toHaveValue('https://portal.exemplo.gov.br/');
    fireEvent.change(url, { target: { value: 'https://www.gov.br/nova-norma.pdf' } });
    fireEvent.change(screen.getByLabelText('Título (edição)'), { target: { value: 'Norma certa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s2', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s2', 'PATCH')[0][1].body)).toEqual({
      entity: 'INSS',
      code: '',
      title: 'Norma certa',
      official_url: 'https://www.gov.br/nova-norma.pdf',
    });
  });

  it('erro da API na edição aparece e o formulário continua aberto', async () => {
    respostas['PATCH /api/normative-sources/s2'] = FALHA({ message: ['A URL aponta para um endereço não público'] });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByText(/endereço não público/)).toBeInTheDocument();
    expect(screen.getByLabelText('URL oficial (edição)')).toBeInTheDocument();
  });

  it('Testar URL no cadastro: mostra a leitura, o aviso de extração suspeita e a fonte duplicada', async () => {
    respostas['POST /api/normative-sources/preview'] = ok({
      ok: true, status_code: 200, mime_type: 'text/html', chars: 120, meaningful_chars: 80, sample: 'Texto de exemplo da página',
      suspicious: 'Conteúdo suspeito: o texto extraído tem 80 caracteres', duplicate_of: { id: 's1', title: 'EPI', code: 'NR-06' },
    });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/nr06.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar URL' }));
    expect(await screen.findByText(/Leitura OK · HTTP 200 · text\/html · 120 caracteres \(80 de texto\)/)).toBeInTheDocument();
    expect(screen.getByText(/Conteúdo suspeito/)).toBeInTheDocument();
    expect(screen.getByText(/já existe a fonte “NR-06 — EPI” com esta URL/)).toBeInTheDocument();
    expect(JSON.parse(chamadas('/api/normative-sources/preview', 'POST')[0][1].body)).toEqual({ official_url: 'https://www.gov.br/nr06.pdf' });
  });

  it('Testar URL com falha de leitura mostra o motivo', async () => {
    respostas['POST /api/normative-sources/preview'] = ok({ ok: false, message: 'Fonte respondeu status 403', duplicate_of: null });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.stf.jus.br/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar URL' }));
    expect(await screen.findByText(/Não foi possível ler a URL: Fonte respondeu status 403/)).toBeInTheDocument();
  });

  it('o cadastro continua enviando o mesmo POST', async () => {
    render(<AdminNormativaPage />);
    fireEvent.change(await screen.findByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'NR nova' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/nr-nova.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    await waitFor(() => expect(chamadas('/api/normative-sources', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources', 'POST')[0][1].body)).toEqual({
      entity: 'MTE',
      title: 'NR nova',
      official_url: 'https://www.gov.br/nr-nova.pdf',
    });
  });
});
```
Em `convencoes-paginas.test.ts`, acrescentar `'normativa/FontesPanel.tsx'` ao fim de `PAGINAS` (nada mais muda).

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/frontend && timeout 180 npx vitest run src/app/admin/__tests__/normativa-fontes.test.tsx`
Expected: FAIL (tabela, ações e "Testar URL" não existem; `FontesPanel.tsx` ainda não existe para a convenção).

- [ ] **Step 3: Implementar — `api.ts` e `FontesPanel.tsx`**

`api.ts`:
```ts
export function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}
```

`FontesPanel.tsx`:
```tsx
'use client';

import { FormEvent, useState } from 'react';
import { Badge, Card } from '@/components/admin/Card';
import type { Tone } from '@/components/admin/Card';
import { authHeaders } from './api';

export interface OfficialSource {
  id: string;
  entity: string;
  code: string | null;
  title: string;
  official_url: string;
  active: boolean;
  last_checked_at: string | null;
  last_check_status: 'ok' | 'erro' | null;
  last_error: string | null;
  consecutive_failures: number;
}

interface Preview {
  ok: boolean;
  message?: string;
  status_code?: number;
  mime_type?: string;
  chars?: number;
  meaningful_chars?: number;
  sample?: string;
  suspicious?: string | null;
  duplicate_of?: { id: string; title: string; code: string | null } | null;
}

interface Rascunho {
  entity: string;
  code: string;
  title: string;
  official_url: string;
}

function formatChecked(iso: string | null): string {
  if (!iso) return 'nunca verificada';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'verificada há menos de 1 h';
  if (hours < 48) return `verificada há ${hours} h`;
  return `verificada há ${Math.floor(hours / 24)} dias`;
}

function estadoDaFonte(s: OfficialSource): { tom: Tone; texto: string } {
  if (!s.active) return { tom: 'neutral', texto: 'Inativa' };
  if (s.consecutive_failures > 0) {
    return { tom: 'bad', texto: `Falhando (${s.consecutive_failures})${s.last_error ? ` — ${s.last_error}` : ''}` };
  }
  if (!s.last_checked_at) return { tom: 'neutral', texto: 'Nunca verificada' };
  return { tom: 'ok', texto: 'ok' };
}

const temProblema = (s: OfficialSource) => !s.active || s.consecutive_failures > 0;

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mensagemDaApi(body: any, padrao: string): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' && m ? m : padrao;
}

function PreviewResultado({ preview }: { preview: Preview }) {
  if (!preview.ok) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Não foi possível ler a URL: {preview.message}
      </p>
    );
  }
  return (
    <div className="adm-card-2 flex flex-col gap-2 p-3 text-sm" aria-live="polite">
      <p className="text-brand-900">
        Leitura OK · HTTP {preview.status_code} · {preview.mime_type} · {preview.chars} caracteres ({preview.meaningful_chars} de texto)
      </p>
      {preview.suspicious && <p className="text-red-600">{preview.suspicious}</p>}
      {preview.duplicate_of && (
        <p className="text-adm-status-warn-text">
          Atenção: já existe a fonte “{preview.duplicate_of.code ? `${preview.duplicate_of.code} — ` : ''}
          {preview.duplicate_of.title}” com esta URL.
        </p>
      )}
      <p className="break-words text-xs text-brand-700">{preview.sample}</p>
    </div>
  );
}

export function FontesPanel({ sources, onChanged }: { sources: OfficialSource[]; onChanged: () => void | Promise<void> }) {
  const [soProblema, setSoProblema] = useState(false);
  const [mensagens, setMensagens] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);

  const [novo, setNovo] = useState<Rascunho>({ entity: '', code: '', title: '', official_url: '' });
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [createErro, setCreateErro] = useState('');
  const [previewNovo, setPreviewNovo] = useState<Preview | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({ entity: '', code: '', title: '', official_url: '' });
  const [editErro, setEditErro] = useState('');
  const [previewEdicao, setPreviewEdicao] = useState<Preview | null>(null);

  const comProblema = sources.filter(temProblema).length;
  const visiveis = soProblema ? sources.filter(temProblema) : sources;

  async function testarUrl(url: string, definir: (p: Preview) => void) {
    try {
      const res = await fetch('/api/normative-sources/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ official_url: url }),
      });
      const body = await res.json().catch(() => null);
      definir(res.ok ? body : { ok: false, message: mensagemDaApi(body, 'Não foi possível testar a URL.') });
    } catch {
      definir({ ok: false, message: 'Não foi possível conectar ao servidor.' });
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateStatus('loading');
    setCreateErro('');
    const res = await fetch('/api/normative-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        entity: novo.entity,
        code: novo.code || undefined,
        title: novo.title,
        official_url: novo.official_url,
      }),
    });
    if (res.ok) {
      setNovo({ entity: '', code: '', title: '', official_url: '' });
      setPreviewNovo(null);
      setCreateStatus('idle');
      await onChanged();
      return;
    }
    const body = await res.json().catch(() => null);
    setCreateErro(mensagemDaApi(body, 'Confira a URL.'));
    setCreateStatus('erro');
  }

  function abrirEdicao(s: OfficialSource) {
    setEditandoId(s.id);
    setRascunho({ entity: s.entity, code: s.code ?? '', title: s.title, official_url: s.official_url });
    setEditErro('');
    setPreviewEdicao(null);
  }

  async function salvarEdicao(event: FormEvent) {
    event.preventDefault();
    if (!editandoId) return;
    setOcupada(editandoId);
    const res = await fetch(`/api/normative-sources/${editandoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(rascunho),
    });
    setOcupada(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setEditErro(mensagemDaApi(body, 'Não foi possível salvar a edição.'));
      return;
    }
    setEditandoId(null);
    await onChanged();
  }

  async function alternarAtiva(s: OfficialSource) {
    setOcupada(s.id);
    const res = await fetch(`/api/normative-sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ active: !s.active }),
    });
    setOcupada(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMensagens((m) => ({ ...m, [s.id]: mensagemDaApi(body, 'Não foi possível alterar a fonte.') }));
      return;
    }
    await onChanged();
  }

  async function verificarAgora(s: OfficialSource) {
    setOcupada(s.id);
    setMensagens((m) => ({ ...m, [s.id]: 'Verificando…' }));
    try {
      const res = await fetch(`/api/normative-sources/${s.id}/check-now`, { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => null);
      const texto = !res.ok
        ? mensagemDaApi(body, 'Não foi possível verificar a fonte.')
        : body?.outcome === 'erro'
          ? `Falhou: ${body.message}`
          : body?.message;
      setMensagens((m) => ({ ...m, [s.id]: texto }));
    } catch {
      setMensagens((m) => ({ ...m, [s.id]: 'Não foi possível conectar ao servidor.' }));
    }
    setOcupada(null);
    await onChanged();
  }

  const rotulo = (s: OfficialSource) => s.code ?? s.title;

  return (
    <Card title="Fontes monitoradas" className="mt-8">
      <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input placeholder="Entidade (ex: MTE)" aria-label="Entidade (ex: MTE)" value={novo.entity} onChange={(e) => setNovo({ ...novo, entity: e.target.value })} required className="adm-input" />
        <input placeholder="Código (ex: NR-06)" aria-label="Código (ex: NR-06)" value={novo.code} onChange={(e) => setNovo({ ...novo, code: e.target.value })} className="adm-input" />
        <input placeholder="Título" aria-label="Título" value={novo.title} onChange={(e) => setNovo({ ...novo, title: e.target.value })} required className="adm-input sm:col-span-2" />
        <input placeholder="URL oficial" aria-label="URL oficial" value={novo.official_url} onChange={(e) => setNovo({ ...novo, official_url: e.target.value })} required className="adm-input sm:col-span-2" />
        {createStatus === 'erro' && (
          <p className="text-sm text-red-600 sm:col-span-2">Não foi possível cadastrar. {createErro}</p>
        )}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" disabled={createStatus === 'loading'} className="adm-btn adm-btn-primary self-start disabled:opacity-50">
            Cadastrar fonte
          </button>
          <button
            type="button"
            disabled={!novo.official_url}
            onClick={() => testarUrl(novo.official_url, setPreviewNovo)}
            className="adm-btn self-start disabled:opacity-50"
          >
            Testar URL
          </button>
        </div>
        {previewNovo && (
          <div className="sm:col-span-2">
            <PreviewResultado preview={previewNovo} />
          </div>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-700">
        <span>
          {sources.length} fontes · {comProblema} com problema
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} />
          Mostrar só fontes com problema ({comProblema})
        </label>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Estado</th>
              <th>Verificação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((s) => {
              const estado = estadoDaFonte(s);
              return [
                <tr key={s.id}>
                  <td className="min-w-0 break-words text-brand-900">
                    <div className="font-medium">
                      {s.entity}
                      {s.code ? ` — ${s.code}` : ''}
                    </div>
                    <div className="text-brand-700">{s.title}</div>
                    <a href={s.official_url} target="_blank" rel="noopener noreferrer" className="adm-link break-all text-xs">
                      {hostDe(s.official_url)}
                    </a>
                  </td>
                  <td>
                    <Badge tone={estado.tom}>{estado.texto}</Badge>
                  </td>
                  <td className="text-xs text-brand-700">{formatChecked(s.last_checked_at)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" disabled={ocupada === s.id} onClick={() => verificarAgora(s)} aria-label={`Verificar agora — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50">
                        Verificar agora
                      </button>
                      <button type="button" onClick={() => abrirEdicao(s)} aria-label={`Editar — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap">
                        Editar
                      </button>
                      <button type="button" disabled={ocupada === s.id} onClick={() => alternarAtiva(s)} aria-label={`${s.active ? 'Desativar' : 'Reativar'} — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50">
                        {s.active ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                    {mensagens[s.id] && (
                      <p role="status" className="mt-1 text-xs text-brand-700">
                        {mensagens[s.id]}
                      </p>
                    )}
                  </td>
                </tr>,
                editandoId === s.id && (
                  <tr key={`${s.id}-edicao`}>
                    <td colSpan={4}>
                      <form onSubmit={salvarEdicao} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input aria-label="Entidade (edição)" value={rascunho.entity} onChange={(e) => setRascunho({ ...rascunho, entity: e.target.value })} required className="adm-input" />
                        <input aria-label="Código (edição)" value={rascunho.code} onChange={(e) => setRascunho({ ...rascunho, code: e.target.value })} className="adm-input" />
                        <input aria-label="Título (edição)" value={rascunho.title} onChange={(e) => setRascunho({ ...rascunho, title: e.target.value })} required className="adm-input sm:col-span-2" />
                        <input aria-label="URL oficial (edição)" value={rascunho.official_url} onChange={(e) => setRascunho({ ...rascunho, official_url: e.target.value })} required className="adm-input sm:col-span-2" />
                        {editErro && <p className="text-sm text-red-600 sm:col-span-2">{editErro}</p>}
                        <div className="flex flex-wrap gap-3 sm:col-span-2">
                          <button type="submit" disabled={ocupada === s.id} className="adm-btn adm-btn-primary self-start disabled:opacity-50">
                            Salvar edição
                          </button>
                          <button type="button" onClick={() => testarUrl(rascunho.official_url, setPreviewEdicao)} className="adm-btn self-start">
                            Testar URL (edição)
                          </button>
                          <button type="button" onClick={() => setEditandoId(null)} className="adm-btn self-start">
                            Cancelar
                          </button>
                        </div>
                        {previewEdicao && (
                          <div className="sm:col-span-2">
                            <PreviewResultado preview={previewEdicao} />
                          </div>
                        )}
                      </form>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Implementar — `page.tsx`**

1. Imports: remover `FormEvent` (e `Badge`, se não for mais usado — conferir com `tsc`/eslint) e acrescentar:
```tsx
import { FontesPanel, type OfficialSource } from './FontesPanel';
import { authHeaders } from './api';
```
2. Remover o `interface OfficialSource {…}` local, a função `authHeaders` local e a `formatChecked` (agora no painel).
3. Remover o estado do cadastro (`entity`, `code`, `title`, `officialUrl`, `createStatus`) e `handleCreateSource`.
4. Trocar **todo o `<Card title="Fontes monitoradas" className="mt-8"> … </Card>`** por:
```tsx
      <FontesPanel sources={sources} onChanged={loadAll} />
```
O resto da página (pendentes, vigentes, revisão, `loadAll`, aprovar/rejeitar/reindexar) **não muda**.

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 240 npx vitest run src/app/admin && npx tsc --noEmit && timeout 120 npx eslint src/app/admin/normativa --max-warnings=0`
Expected: PASS em `normativa-fontes`, `normativa-page` (**os testes existentes da página, sem edição**: falha vermelha `Falhando (2) — timeout`, `aria-label`s do cadastro, POST do cadastro, aprovar/rejeitar/reindexar) e `convencoes-paginas` (agora incluindo `FontesPanel.tsx`); `tsc` e eslint limpos. Se o teste existente da página quebrar, corrigir o **componente** para preservar o comportamento, não o teste.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git status --short src/app/admin | grep -i normativa`
Expected: `page.tsx` modificado; `api.ts`, `FontesPanel.tsx` e o teste novo como `??`; `convencoes-paginas.test.ts` com 1 linha alterada.

---

### Task 5: Verificação do lote, QA visual e documentação

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-monitor-normativo-gerir-fontes-design.md` (acrescentar a seção `## 8. Resultado da verificação`)
- Modify: `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (nova seção `## 0.6 Gerir fontes normativas (2026-10-08)`)
- Sem código de produção novo.

- [ ] **Step 1: Backend — tipos e comparação rigorosa de suítes**

Run:
```bash
cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json
SC=/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad
WT=$SC/wt-fatia2a && git -C /opt/Montese worktree add -q --detach $WT HEAD && ln -s /opt/Montese/backend/node_modules $WT/backend/node_modules
for f in src/common/url/public-url.util.ts src/normative/normative-monitor.service.ts src/normative/official-sources.service.ts src/normative/official-sources.controller.ts src/normative/dto/create-official-source.dto.ts src/normative/dto/update-official-source.dto.ts src/normative/dto/preview-source.dto.ts test/public-url.unit-spec.ts test/normative-monitor-sources.unit-spec.ts test/normative-monitor-guard.unit-spec.ts test/official-sources.unit-spec.ts; do mkdir -p "$WT/backend/$(dirname $f)" && cp "/opt/Montese/backend/$f" "$WT/backend/$f"; done
cd $WT/backend && npx tsc --noEmit -p tsconfig.json && NODE_OPTIONS=--max-old-space-size=2048 timeout 540 npx jest --config ./test/jest-unit.json 2>&1 | grep -E "^Tests:|^Test Suites:|^FAIL "
```
Expected: `tsc` limpo nos dois lugares; no HEAD limpo + fatia, **as mesmas 8 suítes** da lista nas Global Constraints falham (nenhuma a mais) e as suítes novas passam. Depois remover a worktree (`rm $WT/backend/node_modules && git worktree remove --force $WT`). Se aparecer uma falha a mais, **parar** (`superpowers:systematic-debugging`).

- [ ] **Step 2: Frontend — suíte, tipos, lint, build**

Run:
```bash
cd /opt/Montese/frontend
timeout 300 npx vitest run
npx tsc --noEmit
npx eslint src/app/admin src/components/admin --max-warnings=0
NODE_OPTIONS=--max-old-space-size=2048 timeout 540 npx next build
```
Expected: vitest tudo verde; `tsc` limpo; eslint 0 erros (o aviso preexistente em `components/admin/AdminBrand.tsx:13` é conhecido); `next build` compila.

- [ ] **Step 3: Guarda e leitura contra URLs reais (somente leitura)**

(a) As 7 URLs que falhavam e uma amostra das demais, **a partir deste host**, só `GET` em páginas públicas: compilar o utilitário e a extração para o scratchpad (`npx tsc src/common/url/public-url.util.ts src/normative/normative-text.util.ts --outDir $SC/out2 --module commonjs --target es2020 --skipLibCheck`) e rodar um script `node` que, para cada URL, executa `fetchPublic` com `MONITOR_FETCH_HEADERS`, `readBodyCapped`, `decodeHtmlBuffer` e `meaningfulLength` e imprime `status | mime | caracteres | acentos ok?`. Esperado: as 5 do `planalto.gov.br` voltam 200 com acentos corretos (`Presidência`, sem `�`); CAEPI e STF seguem 403.
(b) **As 51 URLs de produção passam na guarda** (nenhuma bloqueada por engano). Isso exige ler `official_sources` em produção, o que o classificador do Claude Code **pode bloquear**: se bloquear, **parar e pedir ao proprietário que rode o export** (`select official_url from official_sources`) e cole o resultado; não contornar.
Registrar os números.

- [ ] **Step 4: QA visual com Playwright (API simulada)**

Seguir a memória `project_visual_qa_tooling`. Servir o build local na porta 3100 (livre), **sem Docker, sem produção, sem credenciais reais**; guardar o PID e encerrar **só** o servidor próprio — **nunca** o `next-server` com `cwd=/app` (é a PRODUÇÃO); usar `timeout`. Sessão falsa de admin; `/api/**` interceptado com ~6 fontes (saudável, falhando, inativa, nunca verificada, com nome longo e URL longa). Em `/admin/normativa`, 1440×900 e 390×844: 0 erros de console; `scrollWidth <= innerWidth` (a tabela rola dentro do cartão); **ler os screenshots** (tabela, badges, ações, formulário de edição aberto, resultado do "Testar URL" com aviso de suspeita e de duplicada, mensagem do "Verificar agora"); foco por Tab nos controles novos; fluxos com corpo/URL conferidos (PATCH `{active:false}`, PATCH da edição, `POST …/check-now`, `POST …/preview`, filtro "só com problema"). Relatório no scratchpad com tabela rota × viewport.

- [ ] **Step 5: Documentar**

Acrescentar à spec a seção `## 8. Resultado da verificação` (números reais dos Steps 1–4, o que ficou **NÃO VERIFICADO**: e2e, guarda contra as 51 URLs reais se bloqueada, DNS rebinding residual, comportamento em produção) e, no doc de release, a seção `## 0.6` com: arquivos, **dependência de liberar backend e frontend juntos** (a tela nova precisa dos endpoints novos), o aviso de que o backend só sai depois do commit/merge do eSocial, e o que não foi verificado. Não executar nenhum passo 🔒.

- [ ] **Step 6: Checkpoint final (sem commit)**

Run: `git status --short backend/src/normative backend/src/common/url backend/test frontend/src/app/admin docs | grep -E "normative|public-url|official|normativa|2026-10-08"`
Expected: os arquivos desta fatia e nenhum de `backend/src/pente-fino/*`. Reportar ao proprietário e **parar**: commit e release são dele.

---

## Self-Review

- **Cobertura da spec:** guarda SSRF com redirecionamento revalidado e limite de tamanho (T1, usada pelo monitor na T2 e pelos endpoints na T3); `PATCH`, `check-now`, `preview` e cadastro endurecido (T3); tela com tabela, filtro, editar, desativar/reativar, verificar agora e testar URL (T4); verificação, QA e documentação (T5). Fora de escopo respeitado: diff, lote, retirar vigente, envio manual, DNS rebinding, exclusão de fonte.
- **Placeholders:** nenhum; todo código de produção e de teste está completo. Os pontos condicionais (normalização de `127.1`/decimal/hex pelo `URL`; leitura de produção pode ser bloqueada) têm ação explícita.
- **Consistência de nomes:** `assertPublicUrl`/`fetchPublic`/`readBodyCapped`/`UnsafeUrlError` (T1) usados em T2 e T3 com as mesmas assinaturas; `checkSource`/`previewUrl` (T2) consumidos na T3; os endpoints da T3 são exatamente os chamados na T4; `OfficialSource` exportado do painel e importado pela página; rótulos "… (edição)" distintos dos do cadastro, para os testes existentes seguirem válidos.
- **Riscos tratados:** DNS fora do ar não bloqueia (testes existentes seguem verdes); `jest.mock('dns/promises')` evita rede nos testes; o monitor noturno passa a usar a guarda (fecha o SSRF já existente); `preview` declarado antes das rotas com `:id`; liberar backend e frontend juntos.
