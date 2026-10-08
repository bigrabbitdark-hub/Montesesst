# Monitor normativo — parar o ruído (fatia 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O monitor das fontes normativas deixa de gerar pendentes de ruído, recupera as fontes bloqueadas por falta de cabeçalho e nunca deixa uma extração vazia virar pendente aprovável.

**Architecture:** Um utilitário puro (`normative-text.util.ts`) com cabeçalhos do monitor, normalização de rótulos voláteis e a barreira de extração suspeita. `NormativeDocumentsService.recordDetectedVersion` passa a comparar o texto normalizado e a manter um pendente por fonte. `NormativeMonitorService.processSource` envia os cabeçalhos e aplica a barreira. Sem migration, sem mudança de schema, sem endpoint novo.

**Tech Stack:** NestJS, TypeScript, pg, jest (unit sem banco; e2e só no ambiente isolado).

**Spec:** `docs/superpowers/specs/2026-10-08-monitor-normativo-parar-ruido-design.md`

## Global Constraints

- Só `backend/` e docs. **Sem migration**, sem variável de ambiente nova, sem endpoint novo, sem mudança de tela, Docker, Nginx ou RLS.
- Todos os comandos rodam em `/opt/Montese/backend`. Sempre com `timeout`.
- **Sem `git commit`, `push`, `add`, `reset`, `revert`, `stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes (`backend/src/pente-fino/*`, `docker-compose.yml`, `PenteFinoPanel*`, docs de eSocial): **nunca** `git add -A`, **nunca** tocar neles.
- **Nunca** usar similaridade percentual para descartar versão (uma emenda real a uma NR grande também dá ~99%). Só rótulos voláteis conhecidos, com prefixo explícito. "Publicado em …" **não** é removido.
- `content_hash` continua sendo o SHA-256 do texto **bruto** (não mudar a semântica: evitaria inundar a fila com uma versão nova de cada uma das 51 fontes).
- A validação humana (Aprovar/Rejeitar) não muda; nada é aprovado sozinho.
- **e2e usam banco e não rodam neste shell** (nunca apontar para o Postgres de produção). Rodar e2e só pela receita de ambiente isolado (`reference_ensaio_descartavel_isolado`), **com autorização do proprietário**; até lá, marcar NÃO VERIFICADO.
- Antes desta fatia, `npx jest --config ./test/jest-unit.json` já tem **8 suítes falhando no HEAD limpo** (`company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`); na árvore completa há ainda `sst-audit-facts`, `sst-audit-pdf` e `tenant-context-callsites` por WIP alheio. Não são desta fatia: **não corrigir, não ocultar**; comparar o conjunto de falhas antes e depois.
- Comentários em PT-BR, curtos. Resposta final aos humanos em PT-BR com VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/normative/normative-text.util.ts` | criar | `MONITOR_FETCH_HEADERS`, `normalizeForComparison`, `MIN_EXTRACTED_CHARS`, `MIN_RATIO_VS_VIGENTE`, `suspiciousExtractionReason` |
| `test/normative-text.unit-spec.ts` | criar | Testes do utilitário |
| `src/normative/normative-documents.service.ts` | modificar (`recordDetectedVersion`) | Comparação normalizada + um pendente por fonte |
| `test/normative-record-detected-version.unit-spec.ts` | criar | `recordDetectedVersion` com cliente e R2 falsos |
| `src/normative/normative-monitor.service.ts` | modificar (`processSource`) | Cabeçalhos + barreira |
| `test/normative-monitor-guard.unit-spec.ts` | criar | Monitor com `fetch` e banco falsos |
| `test/normative-monitor.e2e-spec.ts` | modificar | Fixtures ≥ 100 caracteres, isolamento do teste de e-mail, 2 casos novos |
| `docs/superpowers/specs/2026-10-08-monitor-normativo-parar-ruido-design.md` | já existe | Spec |

---

### Task 1: Utilitário de texto do monitor

**Files:**
- Create: `src/normative/normative-text.util.ts`
- Test: `test/normative-text.unit-spec.ts`

**Interfaces:**
- Produces:
  - `MONITOR_FETCH_HEADERS: Record<string, string>` (`User-Agent`, `Accept`, `Accept-Language`).
  - `normalizeForComparison(text: string): string`.
  - `MIN_EXTRACTED_CHARS = 100`, `MIN_RATIO_VS_VIGENTE = 0.2`.
  - `suspiciousExtractionReason(extractedChars: number, vigenteChars: number | null): string | null`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import {
  MIN_EXTRACTED_CHARS,
  MONITOR_FETCH_HEADERS,
  normalizeForComparison,
  suspiciousExtractionReason,
} from '../src/normative/normative-text.util';

describe('MONITOR_FETCH_HEADERS', () => {
  it('identifica o robô com honestidade, mas começa com Mozilla/5.0 (sem isso o planalto.gov.br deixa a conexão pendurada)', () => {
    expect(MONITOR_FETCH_HEADERS['User-Agent']).toMatch(
      /^Mozilla\/5\.0 \(compatible; MonteseSSTMonitor\/1\.0; \+https:\/\/montesesst\.com\.br\)$/,
    );
    expect(MONITOR_FETCH_HEADERS['Accept-Language']).toContain('pt-BR');
    expect(MONITOR_FETCH_HEADERS['Accept']).toContain('text/html');
  });
});

describe('normalizeForComparison', () => {
  const pagina = (modificado: string) =>
    `Imprensa Nacional Criado em 23/09/2020 14:06 ${modificado} Compartilhe : Busca DOU texto da norma`;

  it('ignora só o rótulo "Modificado em dd/mm/aaaa hh:mm" (caso real do LTCAT)', () => {
    expect(normalizeForComparison(pagina('Modificado em 28/08/2026 09:37'))).toBe(
      normalizeForComparison(pagina('Modificado em 05/10/2026 15:17')),
    );
  });

  it.each([
    'Atualizado em 01/02/2026',
    'Última atualização: 10/10/2026 08:00',
    'Ultima modificacao em 10/10/2026',
    'Última modificação 10/10/2026 08h00',
  ])('remove o rótulo volátil "%s"', (rotulo) => {
    expect(normalizeForComparison(`Art. 1º Texto. ${rotulo} Art. 2º Outro.`)).toBe('Art. 1º Texto. Art. 2º Outro.');
  });

  it('NÃO remove datas que fazem parte do conteúdo da norma', () => {
    const t = 'Publicado em 30/12/2022. Vigência a partir de 01/01/2027. Criado em 23/09/2020 14:06.';
    expect(normalizeForComparison(t)).toBe(t);
  });

  it('uma mudança real de conteúdo continua diferente depois de normalizar', () => {
    const a = 'Art. 1º O prazo é de 30 dias. Modificado em 28/08/2026 09:37';
    const b = 'Art. 1º O prazo é de 60 dias. Modificado em 28/08/2026 09:37';
    expect(normalizeForComparison(a)).not.toBe(normalizeForComparison(b));
  });

  it('colapsa espaços', () => {
    expect(normalizeForComparison('a   b\n\n c ')).toBe('a b c');
  });
});

describe('suspiciousExtractionReason', () => {
  it('texto de 6 caracteres contra uma vigente de 35.754 é suspeito (caso real "EPI e custeio")', () => {
    expect(suspiciousExtractionReason(6, 35754)).toMatch(/Conteúdo suspeito/);
  });

  it(`menos de ${MIN_EXTRACTED_CHARS} caracteres é suspeito mesmo sem versão vigente`, () => {
    expect(suspiciousExtractionReason(MIN_EXTRACTED_CHARS - 1, null)).toMatch(/Conteúdo suspeito/);
    expect(suspiciousExtractionReason(MIN_EXTRACTED_CHARS, null)).toBeNull();
  });

  it('queda para menos de 20% da vigente é suspeita; exatamente 20% não', () => {
    expect(suspiciousExtractionReason(1999, 10000)).toMatch(/caiu para 1999/);
    expect(suspiciousExtractionReason(2000, 10000)).toBeNull();
  });

  it('textos normais não são suspeitos (primeira versão e mudança pequena)', () => {
    expect(suspiciousExtractionReason(7185, null)).toBeNull();
    expect(suspiciousExtractionReason(2185, 2168)).toBeNull();
  });

  it('a mensagem manda conferir a fonte', () => {
    expect(suspiciousExtractionReason(6, 35754)).toMatch(/confira a fonte/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && timeout 180 npx jest --config ./test/jest-unit.json normative-text`
Expected: FAIL (`Cannot find module '../src/normative/normative-text.util'`).

- [ ] **Step 3: Implementar**

```ts
// Utilitários do monitor das fontes normativas: cabeçalhos de requisição, normalização para comparar
// versões e barreira contra extração degenerada. Funções puras, testáveis sem banco.

// O planalto.gov.br deixa a conexão pendurada quando o User-Agent não começa com "Mozilla/5.0"
// (verificado em 2026-10-08: com este UA responde 200 em < 2 s). O UA identifica o robô com honestidade.
export const MONITOR_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; MonteseSSTMonitor/1.0; +https://montesesst.com.br)',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

// Rótulos de data/hora que mudam sozinhos em páginas de portal (ex.: Imprensa Nacional mostra
// "Modificado em 05/10/2026 15:17"). Só entram aqui rótulos com prefixo explícito. NÃO usar similaridade
// percentual nem remover datas em geral: "Publicado em …" e vigências são conteúdo do ato, e uma emenda
// real a uma NR grande também dá ~99% de similaridade.
const DATA_HORA = String.raw`\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}[:h]\d{2}(?::\d{2})?)?`;
const ROTULOS_VOLATEIS: RegExp[] = [
  new RegExp(String.raw`(?:Modificado|Atualizado)\s+em\s+${DATA_HORA}`, 'gi'),
  new RegExp(
    String.raw`[úu]ltima\s+(?:modifica[çc][ãa]o|atualiza[çc][ãa]o)\s*:?\s*(?:em\s+)?${DATA_HORA}`,
    'gi',
  ),
];

export function normalizeForComparison(text: string): string {
  let normalizado = text;
  for (const rotulo of ROTULOS_VOLATEIS) {
    normalizado = normalizado.replace(rotulo, ' ');
  }
  return normalizado.replace(/\s+/g, ' ').trim();
}

// Extração vazia ou quebrada não pode virar pendente aprovável: aprovar substituiria uma norma boa do
// Assistente por lixo (caso real: 6 caracteres contra 35.754 da vigente).
export const MIN_EXTRACTED_CHARS = 100;
export const MIN_RATIO_VS_VIGENTE = 0.2;

export function suspiciousExtractionReason(extractedChars: number, vigenteChars: number | null): string | null {
  if (extractedChars < MIN_EXTRACTED_CHARS) {
    return `Conteúdo suspeito: o texto extraído tem ${extractedChars} caracteres (mínimo ${MIN_EXTRACTED_CHARS}); a página pode ter mudado de formato ou bloqueado o robô — confira a fonte`;
  }
  if (vigenteChars && extractedChars < vigenteChars * MIN_RATIO_VS_VIGENTE) {
    return `Conteúdo suspeito: o texto extraído caiu para ${extractedChars} caracteres (a versão vigente tem ${vigenteChars}); a página pode ter mudado de formato — confira a fonte`;
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-text && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (todos os casos); `tsc` limpo. Se um caso de `it.each` de rótulo falhar, corrigir a **regex** (não o teste): o rótulo deve sumir e o resto da frase ficar intacto.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short src/normative test | grep normative-text`
Expected: os 2 arquivos novos como `??`.

---

### Task 2: `recordDetectedVersion` — comparação normalizada e um pendente por fonte

**Files:**
- Modify: `src/normative/normative-documents.service.ts` (import e método `recordDetectedVersion`)
- Test: `test/normative-record-detected-version.unit-spec.ts`

**Interfaces:**
- Consumes: `normalizeForComparison` (Task 1); `R2Service.putObject/deleteObject`.
- Produces: o mesmo método com contrato ajustado — devolve a linha criada **só quando uma versão nova foi criada**; devolve `null` quando nada mudou, quando a mudança é só de rótulo volátil **ou quando atualizou o pendente existente no lugar**.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { createHash } from 'crypto';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

type Ultimo = { id: string; status: string; content_hash: string; raw_text: string; file_key: string };

function montar(ultimo?: Ultimo) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('SELECT id, status, content_hash, raw_text, file_key')) return { rows: ultimo ? [ultimo] : [] };
      if (sql.includes('INSERT INTO normative_documents')) return { rows: [{ id: params[0], status: 'aguardando_validacao' }] };
      return { rows: [], rowCount: 1 };
    }),
  };
  const r2: any = { putObject: jest.fn(async () => undefined), deleteObject: jest.fn(async () => undefined) };
  const service = new NormativeDocumentsService(r2, {} as any);
  const gravou = (prefixo: string) => consultas.filter((c) => c.sql.trim().startsWith(prefixo));
  return { service, client, r2, gravou };
}

const URL = 'https://exemplo.gov.br/norma.htm';
const ultimo = (status: string, texto: string, id = 'doc-1'): Ultimo => ({
  id,
  status,
  content_hash: sha(texto),
  raw_text: texto,
  file_key: `normative/src-1/${id}/norma.htm`,
});

describe('recordDetectedVersion', () => {
  it('primeira versão da fonte: cria o pendente e devolve a linha', async () => {
    const { service, client, r2, gravou } = montar();
    const criado = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º Texto novo.', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
    expect(r2.putObject).toHaveBeenCalledTimes(1);
  });

  it('mesmo texto da versão mais recente: não faz nada', async () => {
    const { service, client, r2, gravou } = montar(ultimo('vigente', 'Art. 1º Texto.'));
    const r = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º Texto.', Buffer.from('x'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('só o rótulo "Modificado em" mudou (caso real do LTCAT): não é versão nova', async () => {
    const antes = 'Criado em 23/09/2020 14:06 Modificado em 28/08/2026 09:37 Compartilhe texto da norma';
    const depois = 'Criado em 23/09/2020 14:06 Modificado em 05/10/2026 15:17 Compartilhe texto da norma';
    const { service, client, r2, gravou } = montar(ultimo('vigente', antes));
    const r = await service.recordDetectedVersion(client, 'src-1', depois, Buffer.from('x'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('mudança real sobre a vigente: cria um pendente novo e devolve a linha', async () => {
    const { service, client, gravou } = montar(ultimo('vigente', 'Art. 1º O prazo é de 30 dias.'));
    const criado = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º O prazo é de 60 dias.', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
    expect(gravou('UPDATE')).toHaveLength(0);
  });

  it('mudança real sobre uma rejeitada: cria um pendente novo', async () => {
    const { service, client, gravou } = montar(ultimo('rejeitado', 'texto antigo rejeitado'));
    const criado = await service.recordDetectedVersion(client, 'src-1', 'texto bem diferente agora', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
  });

  it('já existe um pendente e o texto mudou de verdade: ATUALIZA no lugar (um pendente por fonte) e devolve null', async () => {
    const { service, client, r2, gravou } = montar(ultimo('aguardando_validacao', 'versão de ontem', 'doc-pend'));
    const r = await service.recordDetectedVersion(client, 'src-1', 'versão de hoje, diferente', Buffer.from('novo'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    const update = gravou('UPDATE normative_documents');
    expect(update).toHaveLength(1);
    expect(update[0].sql).toContain("status = 'aguardando_validacao'");
    expect(update[0].params[0]).toBe('doc-pend');
    expect(update[0].params[1]).toBe(sha('versão de hoje, diferente'));
    expect(update[0].params[5]).toBe('versão de hoje, diferente');
    expect(r2.putObject).toHaveBeenCalledWith('normative/src-1/doc-pend/norma.htm', Buffer.from('novo'), 'text/html');
    expect(r2.deleteObject).not.toHaveBeenCalled(); // mesma chave: sobrescreve
  });

  it('pendente existente com arquivo de nome diferente: grava na chave nova e apaga a antiga (best-effort)', async () => {
    const pendente = { ...ultimo('aguardando_validacao', 'ontem', 'doc-pend'), file_key: 'normative/src-1/doc-pend/antigo.pdf' };
    const { service, client, r2 } = montar(pendente);
    await service.recordDetectedVersion(client, 'src-1', 'hoje diferente', Buffer.from('n'), 'text/html', URL);
    expect(r2.putObject).toHaveBeenCalledWith('normative/src-1/doc-pend/norma.htm', expect.anything(), 'text/html');
    expect(r2.deleteObject).toHaveBeenCalledWith('normative/src-1/doc-pend/antigo.pdf');
  });

  it('falha ao apagar o arquivo antigo não derruba a atualização', async () => {
    const pendente = { ...ultimo('aguardando_validacao', 'ontem', 'doc-pend'), file_key: 'normative/src-1/doc-pend/antigo.pdf' };
    const { service, client, r2 } = montar(pendente);
    r2.deleteObject.mockRejectedValue(new Error('R2 fora do ar'));
    await expect(
      service.recordDetectedVersion(client, 'src-1', 'hoje diferente', Buffer.from('n'), 'text/html', URL),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-record-detected-version`
Expected: FAIL (a query atual não seleciona `raw_text`/`file_key`; pendente existente gera INSERT).

- [ ] **Step 3: Implementar**

Em `normative-documents.service.ts`, acrescentar ao bloco de imports:

```ts
import { normalizeForComparison } from './normative-text.util';
```

e substituir **todo o método `recordDetectedVersion`** (incluindo o comentário que o antecede) por:

```ts
  // Compara com a linha MAIS RECENTE da fonte, qualquer status — não só `vigente` (correção sobre a spec
  // seção 4.2): comparar só com `vigente` recriaria um pendente duplicado a cada rodada enquanto a mesma
  // versão ficasse pendente de revisão ou já rejeitada.
  //
  // Duas regras a mais (fatia "parar o ruído", 2026-10-08):
  //  1. A comparação usa o texto normalizado (sem rótulos como "Modificado em dd/mm/aaaa hh:mm"): mudança
  //     só nesses rótulos não é versão nova. `content_hash` continua sendo o hash do texto BRUTO.
  //  2. Um pendente por fonte: se a mais recente já é `aguardando_validacao` e o texto mudou de verdade,
  //     atualiza essa linha no lugar em vez de empilhar uma por dia. Devolve null nesse caso (não criou
  //     versão nova; evita o e-mail "nova versão" diário de páginas instáveis).
  async recordDetectedVersion(
    client: PoolClient,
    sourceId: string,
    text: string,
    fileBuffer: Buffer,
    mimeType: string,
    sourceUrl: string,
  ): Promise<NormativeDocument | null> {
    const hash = createHash('sha256').update(text).digest('hex');

    const mostRecent = await client.query<{
      id: string;
      status: NormativeDocumentStatus;
      content_hash: string;
      raw_text: string;
      file_key: string;
    }>(
      `SELECT id, status, content_hash, raw_text, file_key FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceId],
    );
    const last = mostRecent.rows[0];
    if (last?.content_hash === hash) {
      return null;
    }
    if (last && normalizeForComparison(last.raw_text) === normalizeForComparison(text)) {
      return null;
    }

    const fileName = sourceUrl.split('/').pop() || 'documento';

    if (last?.status === 'aguardando_validacao') {
      const fileKey = `normative/${sourceId}/${last.id}/${fileName}`;
      await this.r2.putObject(fileKey, fileBuffer, mimeType);
      // WHERE ... AND status: se o admin aprovou/rejeitou entre o SELECT e este UPDATE, não mexe numa
      // linha que já deixou de ser pendente (a próxima rodada reavalia).
      await client.query(
        `UPDATE normative_documents
         SET content_hash = $2, file_key = $3, file_name = $4, mime_type = $5, raw_text = $6, detected_at = now()
         WHERE id = $1 AND status = 'aguardando_validacao'`,
        [last.id, hash, fileKey, fileName, mimeType, text],
      );
      if (last.file_key !== fileKey) {
        try {
          await this.r2.deleteObject(last.file_key);
        } catch (err) {
          this.logger.warn(`Não consegui apagar o arquivo antigo ${last.file_key}: ${(err as Error).message}`);
        }
      }
      return null;
    }

    const id = randomUUID();
    const fileKey = `normative/${sourceId}/${id}/${fileName}`;
    await this.r2.putObject(fileKey, fileBuffer, mimeType);

    const result = await client.query<NormativeDocument>(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'aguardando_validacao', $3, $4, $5, $6, $7) RETURNING *`,
      [id, sourceId, hash, fileKey, fileName, mimeType, text],
    );
    return result.rows[0];
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-record-detected-version normative-text && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (8 + testes da Task 1); `tsc` limpo.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git diff --stat src/normative/normative-documents.service.ts`
Expected: só esse arquivo de produção modificado nesta tarefa; o diff toca imports e `recordDetectedVersion`, nada de `approve`/`reindex`/`replaceChunks`.

---

### Task 3: Monitor — cabeçalhos e barreira de extração suspeita

**Files:**
- Modify: `src/normative/normative-monitor.service.ts` (import e `processSource`)
- Test: `test/normative-monitor-guard.unit-spec.ts`

**Interfaces:**
- Consumes: `MONITOR_FETCH_HEADERS`, `suspiciousExtractionReason` (Task 1).
- Produces: `processSource` envia os cabeçalhos; lança `Error` com a mensagem "Conteúdo suspeito: …" quando a barreira dispara (cai no `catch` de `runOnce`: `recordFailure`, contador, e-mail na 2ª falha seguida).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { NormativeMonitorService } from '../src/normative/normative-monitor.service';

const PAGINA_LONGA = `<html><body><div id="content-core">${'Texto da norma regulamentadora. '.repeat(20)}</div></body></html>`;
const PAGINA_VAZIA = '<html><body>curto</body></html>';

function montar(vigenteChars: number | null) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM official_sources')) {
        return { rows: [{ id: 's1', code: 'NR-06', title: 'EPI', official_url: 'https://exemplo.gov.br/nr06.htm' }] };
      }
      if (sql.includes('length(raw_text)')) return { rows: vigenteChars === null ? [] : [{ len: vigenteChars }] };
      if (sql.includes("last_check_status = 'erro'")) return { rows: [{ consecutive_failures: 1 }] };
      return { rows: [] };
    }),
  };
  const db: any = { withoutTenantContext: jest.fn(async (cb: any) => cb(client)) };
  const documents: any = { recordDetectedVersion: jest.fn(async () => null) };
  const email: any = { send: jest.fn(async () => undefined) };
  const service = new NormativeMonitorService(db, documents, email);
  const falhas = () => consultas.filter((c) => c.sql.includes("last_check_status = 'erro'"));
  const sucessos = () => consultas.filter((c) => c.sql.includes("last_check_status = 'ok'"));
  return { service, documents, email, falhas, sucessos };
}

function simularFetch(html: string) {
  return jest
    .spyOn(global, 'fetch' as any)
    .mockImplementation(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) as any);
}

describe('NormativeMonitorService — cabeçalhos e barreira de extração suspeita', () => {
  afterEach(() => jest.restoreAllMocks());

  it('envia o User-Agent identificado e os cabeçalhos de Accept ao buscar a fonte', async () => {
    const fetchSpy = simularFetch(PAGINA_LONGA);
    const { service } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    const init = fetchSpy.mock.calls[0][1] as any;
    expect(init.headers['User-Agent']).toMatch(/^Mozilla\/5\.0 \(compatible; MonteseSSTMonitor\/1\.0;/);
    expect(init.headers['Accept-Language']).toContain('pt-BR');
  });

  it('texto normal: registra a versão e marca a fonte como ok', async () => {
    simularFetch(PAGINA_LONGA);
    const { service, documents, falhas, sucessos } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).toHaveBeenCalledTimes(1);
    expect(sucessos()).toHaveLength(1);
    expect(falhas()).toHaveLength(0);
  });

  it('extração minúscula (caso real "EPI e custeio", 6 caracteres): NÃO cria pendente e registra falha visível', async () => {
    simularFetch(PAGINA_VAZIA);
    const { service, documents, falhas, sucessos } = montar(35754);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
    expect(sucessos()).toHaveLength(0);
    expect(falhas()).toHaveLength(1);
    expect(falhas()[0].params[1]).toMatch(/Conteúdo suspeito/);
    expect(falhas()[0].params[1]).toMatch(/confira a fonte/);
  });

  it('queda para menos de 20% da vigente também é barrada', async () => {
    simularFetch(PAGINA_LONGA); // ~640 caracteres de texto
    const { service, documents, falhas } = montar(100000);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
    expect(falhas()[0].params[1]).toMatch(/caiu para/);
  });

  it('sem versão vigente, texto pequeno mas acima do mínimo passa', async () => {
    simularFetch(`<html><body>${'x '.repeat(60)}</body></html>`);
    const { service, documents } = montar(null);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(documents.recordDetectedVersion).toHaveBeenCalledTimes(1);
  });

  it('a barreira conta como falha da fonte: 1ª falha não envia e-mail', async () => {
    simularFetch(PAGINA_VAZIA);
    const { service, email } = montar(35754);
    await service.runOnce({ onlySourceIds: ['s1'] });
    expect(email.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-monitor-guard`
Expected: FAIL (cabeçalhos ausentes; `recordDetectedVersion` é chamado com o texto minúsculo).

- [ ] **Step 3: Implementar**

Em `normative-monitor.service.ts`, acrescentar ao bloco de imports:

```ts
import { MONITOR_FETCH_HEADERS, suspiciousExtractionReason } from './normative-text.util';
```

Em `processSource`, trocar a linha do `fetch`:

```ts
    const response = await fetch(url, { headers: MONITOR_FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
```

e, entre o fim do bloco `if (contentType.includes('pdf') …) { … } else { … }` (onde `text` e `mimeType` já estão definidos) e a chamada `const created = await this.db.withoutTenantContext(…recordDetectedVersion…)`, inserir:

```ts
    // Barreira contra extração vazia/quebrada: não vira pendente (aprovar substituiria uma norma boa por
    // lixo). Vira falha da fonte — badge vermelho na tela e e-mail na 2ª falha seguida.
    const vigenteChars = await this.db.withoutTenantContext(async (client) => {
      const { rows } = await client.query<{ len: number }>(
        `SELECT length(raw_text) AS len FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
        [sourceId],
      );
      return rows[0]?.len ?? null;
    });
    const suspeita = suspiciousExtractionReason(text.trim().length, vigenteChars);
    if (suspeita) {
      throw new Error(suspeita);
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json normative-monitor-guard normative-record-detected-version normative-text && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git diff --stat src/normative/normative-monitor.service.ts`
Expected: só esse arquivo; o diff toca o import e `processSource`.

---

### Task 4: Ajustar e ampliar o e2e do monitor (escrever agora; rodar só no ambiente isolado, com autorização)

**Files:**
- Modify: `test/normative-monitor.e2e-spec.ts`

**Interfaces:**
- Consumes: o comportamento novo das Tasks 2–3.
- Produces: e2e coerente com a barreira (fixtures ≥ 100 caracteres), com o teste do e-mail isolado do pendente anterior e com 2 casos novos.

- [ ] **Step 1: Alongar os fixtures curtos**

No topo do arquivo (depois dos imports), acrescentar:

```ts
// A barreira de extração suspeita exige >= 100 caracteres de texto: as páginas simuladas precisam ser maiores.
const corpo = (frase: string) => `${frase} `.repeat(8).trim();
```

e trocar os 3 HTMLs fixos (linhas ~102, ~133 e ~183):

- `'<html><body><p>Conteúdo da norma de teste.</p></body></html>'` → `` `<html><body><p>${corpo('Conteúdo da norma de teste.')}</p></body></html>` ``
- as duas ocorrências de `'<html><body><p>Conteúdo mudou de novo.</p></body></html>'` → `` `<html><body><p>${corpo('Conteúdo mudou de novo.')}</p></body></html>` ``

e, no teste do e-mail-resumo (linha ~237), trocar `` const conteudoNovo = `Conteúdo versão ${Date.now()}`; `` por:

```ts
    const conteudoNovo = corpo(`Conteúdo versão ${Date.now()}`);
```

- [ ] **Step 2: Isolar o teste do e-mail-resumo do pendente de testes anteriores**

No início do teste `'um único e-mail-resumo por rodada quando há uma falha repetida e uma versão nova'`, antes de `await setFailures(sourceIdFalha, 1);`, acrescentar (agora que um pendente existente é atualizado no lugar e não gera o evento "nova versão", o teste precisa partir de uma fonte sem pendente):

```ts
    // Com um pendente já existente a mudança só o atualiza no lugar (sem e-mail de "nova versão"):
    // parte de uma fonte sem documentos para que a versão desta rodada seja de fato nova.
    await (db as any).client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceIdPdf]);
```

- [ ] **Step 3: Acrescentar os 2 casos novos** (antes do `it('falha no envio do e-mail …')`)

```ts
  it('com um pendente já existente, uma mudança real o atualiza no lugar (um pendente por fonte) e não envia e-mail de "nova versão"', async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceIdPdf]);
    const servir = (texto: string) =>
      (fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://exemplo.gov.br/norma-teste.html') {
          return new Response(`<html><body><p>${texto}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        throw new Error('URL inesperada nesta chamada do teste: ' + url);
      }));

    servir(corpo('Versão A da norma.'));
    await monitor.runOnce({ onlySourceIds: [sourceIdPdf] });
    fetchSpy?.mockRestore();
    sendMock.mockClear();

    servir(corpo('Versão B da norma, realmente diferente.'));
    await monitor.runOnce({ onlySourceIds: [sourceIdPdf] });

    const docs = await client.query('SELECT status, raw_text FROM normative_documents WHERE source_id = $1', [sourceIdPdf]);
    expect(docs.rows).toHaveLength(1);
    expect(docs.rows[0].status).toBe('aguardando_validacao');
    expect(docs.rows[0].raw_text).toContain('Versão B');
    expect(sendMock.mock.calls.filter(([arg]) => arg.to === adminEmail)).toHaveLength(0);
  });

  it('extração minúscula não cria pendente e conta como falha da fonte', async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceIdPdf]);
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body>curto</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await monitor.runOnce({ onlySourceIds: [sourceIdPdf] });

    const docs = await client.query('SELECT id FROM normative_documents WHERE source_id = $1', [sourceIdPdf]);
    expect(docs.rows).toHaveLength(0);
    expect((await stateOf(sourceIdPdf)).last_check_status).toBe('erro');
    expect((await stateOf(sourceIdPdf)).last_error).toMatch(/Conteúdo suspeito/);
  });
```

(`stateOf`, `sendMock`, `adminEmail`, `fetchSpy` já existem no arquivo. Se algum nome diferir, ajustar **só o teste**.)

- [ ] **Step 4: Conferir que compila (não rodar contra banco)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros. **Não executar** `test:e2e` neste shell. Marcar NÃO VERIFICADO até rodar no ambiente isolado.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git diff --stat test/normative-monitor.e2e-spec.ts`
Expected: só esse arquivo de e2e modificado nesta tarefa.

---

### Task 5: Verificação com dados reais (somente leitura), suíte e documentação

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-monitor-normativo-parar-ruido-design.md` (acrescentar o resultado da verificação, seção 8)
- Sem código de produção novo.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: relatório com VERIFICADO / NÃO VERIFICADO.

- [ ] **Step 1: Suíte unitária comparada com a linha de base**

Run:
```bash
cd /opt/Montese/backend
NODE_OPTIONS=--max-old-space-size=2048 timeout 540 npx jest --config ./test/jest-unit.json 2>&1 | grep -E "^Tests:|^Test Suites:|^FAIL " | sort -u
npx tsc --noEmit -p tsconfig.json
```
Expected: as suítes novas passam; o conjunto de falhas é **o mesmo de antes** (8 do HEAD limpo + 3 por WIP alheio, ver Global Constraints), **sem nenhuma suíte a mais**. Uma suíte nova falhando ⇒ parar e investigar (`superpowers:systematic-debugging`).

- [ ] **Step 2: Simulação com os dados reais de produção (somente leitura)**

Compilar o utilitário para o scratchpad e rodá-lo sobre cópias dos textos lidos do banco. **Somente `SELECT`**; nada é gravado; textos de norma são públicos, mas não imprimir além de métricas e trechos curtos.

```bash
SC=/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad
cd /opt/Montese/backend && npx tsc src/normative/normative-text.util.ts --outDir $SC/out --module commonjs --target es2020 --skipLibCheck
Q() { docker exec montese_postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F '|' -c \"$1\""; }
# (a) as 36 trocas históricas: (nova, anterior)
Q "select replace(encode(convert_to(n.raw_text,'UTF8'),'base64'),E'\n',''), replace(encode(convert_to(o.raw_text,'UTF8'),'base64'),E'\n','') from normative_documents n join normative_documents o on o.id=n.supersedes_document_id" > $SC/pares.txt
# (b) os pendentes atuais com a vigente (se houver)
Q "select coalesce(s.code,left(s.title,25)), extract(day from now()-d.detected_at)::int, replace(encode(convert_to(d.raw_text,'UTF8'),'base64'),E'\n',''), coalesce((select replace(encode(convert_to(p.raw_text,'UTF8'),'base64'),E'\n','') from normative_documents p where p.source_id=d.source_id and p.status='vigente' limit 1),'') from normative_documents d join official_sources s on s.id=d.source_id where d.status='aguardando_validacao' order by d.detected_at" > $SC/pend.txt
node - <<'EOF'
const fs=require('fs'); const SC='/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad';
const u=require(SC+'/out/normative-text.util.js'); const dec=b=>Buffer.from(b,'base64').toString('utf8');
let ocultadas=0,total=0;
for(const l of fs.readFileSync(SC+'/pares.txt','utf8').split('\n').filter(Boolean)){const [n,o]=l.split('|'); total++; if(u.normalizeForComparison(dec(n))===u.normalizeForComparison(dec(o))) ocultadas++;}
console.log(`(a) trocas históricas escondidas pela normalização: ${ocultadas} de ${total}  (esperado: 0)`);
let supr=0,susp=0,mantem=0;
for(const l of fs.readFileSync(SC+'/pend.txt','utf8').split('\n').filter(Boolean)){const [code,dias,n,o]=l.split('|'); const nt=dec(n), ot=o?dec(o):null;
  const s=u.suspiciousExtractionReason(nt.trim().length, ot?ot.length:null);
  if(s){susp++;console.log(`   ${code}: BARRADO (${nt.length} car. vs vigente ${ot?ot.length:'—'})`);continue;}
  if(ot&&u.normalizeForComparison(nt)===u.normalizeForComparison(ot)){supr++;console.log(`   ${code}: SUPRIMIDO (só rótulo volátil)`);continue;}
  mantem++; console.log(`   ${code}: segue como pendente (${nt.length} car.)`);}
console.log(`(b) pendentes de hoje -> barrados=${susp} suprimidos=${supr} mantidos=${mantem}  (a TNU, mantida, passa a ser 1 só pela regra de um pendente por fonte)`);
EOF
```
Expected: `(a)` = **0 de 36** (nenhuma mudança real histórica seria escondida); `(b)` mostra o "EPI e custeio" **BARRADO**, os 2 do LTCAT **SUPRIMIDOS** e os da TNU como mantidos (que a regra de um pendente por fonte reduz a 1). Se `(a)` > 0, **parar**: a normalização está escondendo mudança real; ajustar a regex (Task 1) antes de seguir.

- [ ] **Step 3: Registrar na spec**

Acrescentar à spec a seção `## 8. Resultado da verificação (data)` com: testes unitários (contagem), `tsc`, comparação da suíte (mesmo conjunto de falhas), o resultado da simulação `(a)` e `(b)` com os números reais, e o que ficou **NÃO VERIFICADO** (e2e no ambiente isolado; efeito real sobre o `planalto.gov.br` só na primeira rodada de produção; as 2 fontes com 403).

- [ ] **Step 4: Checkpoint final (sem commit)**

Run: `git status --short backend/src/normative backend/test docs/superpowers | grep -E "normative|2026-10-08"`
Expected: os arquivos desta fatia (File Structure) e nada de `backend/src/pente-fino/*`. Reportar ao proprietário e **parar**: commit e release do backend são dele (o backend de produção hoje é `0969bb7-esocial-wip2`; só liberar depois do commit/merge do eSocial).

---

## Self-Review

- **Cobertura da spec:** cabeçalhos (T1 constante + T3), rótulos voláteis sem similaridade (T1 + T2), um pendente por fonte (T2), barreira de extração suspeita (T1 + T3), sem migration (nenhuma tarefa de schema), e2e ajustado e ampliado (T4), verificação com dados reais e comparação da suíte (T5).
- **Placeholders:** nenhum; o código de produção e os testes estão completos. Os pontos condicionais (regex do rótulo, nomes de helpers do e2e) têm ação explícita.
- **Consistência de nomes:** `MONITOR_FETCH_HEADERS`, `normalizeForComparison`, `MIN_EXTRACTED_CHARS`, `MIN_RATIO_VS_VIGENTE`, `suspiciousExtractionReason` definidos na T1 e usados com as mesmas assinaturas em T2/T3/T5; o `SELECT id, status, content_hash, raw_text, file_key` da T2 é o mesmo que o cliente falso do teste reconhece.
- **Riscos tratados:** não esconder mudança real (T1 teste "NÃO remove datas…" + T5 `(a)` = 0 de 36); não inundar a fila no deploy (hash bruto preservado); revogação legítima vira falha visível, não silenciosa (spec §5); e2e que dependia do e-mail "versão nova" ajustado (T4 passo 2).

---

## Adendo pós-revisão final (2026-10-08) — o que mudou em relação ao texto acima

A revisão final reprovou o desenho "atualizar o pendente no lugar" e achou três defeitos. O plano acima descreve o **primeiro** desenho; **vale o que está aqui e o código atual** (`backend/src/normative/*`).

- **Task 2 (substituída):** `recordDetectedVersion` **não** atualiza o pendente. Depois das checagens de hash bruto e de texto normalizado, `if (last?.status === 'aguardando_validacao') return null;` — pendente **congelado**, sem nenhuma escrita (nem UPDATE, nem `putObject`, nem `deleteObject`). Contrato: devolve a linha só ao **criar** versão nova. Os testes de "atualiza no lugar / chave nova / `rowCount`" foram trocados por um teste do congelamento.
- **Task 1 (acrescida):** `decodeHtmlBuffer(buffer, contentType)` (Content-Type → `<meta charset>` → UTF-8 estrito → windows-1252), `meaningfulLength(text)` (ignora `-- n of N --`), e as regexes de rótulo volátil **sem** a flag `i`.
- **Task 3 (ajustada):** o ramo HTML de `processSource` usa `decodeHtmlBuffer`; a barreira usa `meaningfulLength(text)`.
- **Task 4 (ajustada):** o e2e "um pendente já existente" documenta o **congelamento** (a linha mantém a versão A; sem e-mail).
- **Task 5, Expected corrigido:** a simulação deve mostrar `(a)` 0 de 36 escondidas; `(b)` **1 barrado** (EPI e custeio); os 2 do LTCAT **não** são suprimidos (carimbo **e** item de menu novo). A lista de falhas por WIP alheio na árvore completa **oscila** (`pente-fino-controller`, `sst-audit-*`, `tenant-context-callsites`): a comparação confiável é **HEAD limpo + só a fatia vs HEAD limpo**, e deu conjunto idêntico (8 suítes, 20 testes).
- **Global Constraints, corrigido:** o conjunto de falhas "alheias" não é fixo; usar a comparação em HEAD limpo.

