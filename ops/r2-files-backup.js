'use strict';
// Cópia dos ARQUIVOS do bucket R2 de produção (documentos dos clientes, fichas
// e assinaturas de EPI, certificados eSocial cifrados, base normativa, RAG)
// para um BUCKET DEDICADO de backup, com credencial SEPARADA — e restauração
// segura no sentido inverso.
//
// Roda num container EFÊMERO criado por ops/backup-r2-files.sh a partir da
// imagem do backend (que já tem @aws-sdk/client-s3). Ver
// docs/operations/backups.md, seção "Cópia dos arquivos".
//
// Bucket principal (produção): R2_ENDPOINT, R2_ACCESS_KEY_ID,
//   R2_SECRET_ACCESS_KEY, R2_BUCKET (as da aplicação).
// Bucket de backup: R2_BACKUP_ENDPOINT, R2_BACKUP_ACCESS_KEY_ID,
//   R2_BACKUP_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET.
//
// Ações (env FILES_BACKUP_ACTION):
//   sync (padrão)     produção → backup. Copia o que falta/diverge e confere com
//                     HeadObject. Escreve SÓ se o backup tiver o sentinela.
//   verify            compara produção × backup (sem escrever)
//   list-missing      lista (até 200) chaves que faltam no backup
//   init-destination  grava o sentinela `_montese-backup-destination` no backup
//                     (exige FILES_BACKUP_CONFIRM_BUCKET=<R2_BACKUP_BUCKET>)
//   list-superseded   lista versões preservadas em _superseded/ (sem apagar)
//   restore           backup → produção. Os papéis são trocados AQUI DENTRO.
//                     Só copia o que FALTA e grava com If-None-Match: * (um
//                     objeto criado na produção depois da listagem NÃO é
//                     sobrescrito: vira createdMeanwhileNotOverwritten). Exige
//                     FILES_BACKUP_CONFIRM_BUCKET=<R2_BUCKET> e um
//                     FILES_BACKUP_PREFIX estreito (tenants/<id>/...,
//                     normative/..., esocial-certificates/..., RAG.../<algo>);
//                     amplo só com FILES_BACKUP_ALLOW_BROAD_RESTORE=1.
//
// Opções (env): FILES_BACKUP_DRY_RUN=1, FILES_BACKUP_CONCURRENCY (4, máx 16),
//   FILES_BACKUP_RETRIES (3), FILES_BACKUP_BACKOFF_MS (1000),
//   FILES_BACKUP_TIMEOUT_MS (300000 por objeto), FILES_BACKUP_PART_SIZE_MB (8),
//   FILES_BACKUP_MULTIPART_MB (8), FILES_BACKUP_PREFIX,
//   FILES_BACKUP_ONLY_MISSING=1, FILES_BACKUP_VERIFY_DEEP=1,
//   FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS, FILES_BACKUP_FORCE_PATH_STYLE=1 (MinIO).
//
// Garantias:
//   - Nenhum DeleteObject neste arquivo. Objeto divergente no backup é
//     preservado em `_superseded/<etag-antigo>/<chave>` (chave determinística:
//     não duplica) antes de ser sobrescrito.
//   - No sentido normal a produção só recebe List/Get/Head; no restore a
//     produção só recebe objetos que NÃO existem lá.
//   - Recusa mesmo destino: host normalizado + bucket, IPs resolvidos + bucket,
//     mesma access key, e sentinela (pega aliases de DNS).
//   - Nunca imprime valores das variáveis nem conteúdo. stdout = só a linha
//     JSON final; mensagens de erro vão para stderr. Exit 1 se houver falha.

const crypto = require('crypto');
const dns = require('dns');

const EXCLUDED_PREFIX = 'backups/';
const SUPERSEDED_PREFIX = '_superseded/';
const SENTINEL_KEY = '_montese-backup-destination';
// Prefixos de primeiro nível permitidos. 'RAG...' cobre 'RAG MONTESESST/...'.
const KEY_RE = /^(tenants\/|normative\/|esocial-certificates\/|RAG[^/]*\/)/;
const LIST_PREFIXES = ['tenants/', 'normative/', 'esocial-certificates/', 'RAG'];
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_KEY_BYTES = 1024;
const MAX_LISTED = 200;
const MAX_KEY_CHARS = 200;
const MAX_REASON_CHARS = 300;
const META_SRC_ETAG = 'montese-src-etag';
const META_SHA256 = 'montese-sha256';
const META_SRC_SIZE = 'montese-src-size';
const MIB = 1024 * 1024;
const ABORT_MPU_TIMEOUT_MS = 30000;

const PROD_VARS = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const BACKUP_VARS = ['R2_BACKUP_ENDPOINT', 'R2_BACKUP_ACCESS_KEY_ID', 'R2_BACKUP_SECRET_ACCESS_KEY', 'R2_BACKUP_BUCKET'];
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ACTIONS = ['sync', 'verify', 'list-missing', 'init-destination', 'list-superseded', 'restore'];

// Restore "estreito": um tenant, ou um prefixo de base global (normative/,
// esocial-certificates/, RAG.../<algo>). Mais amplo que isso exige
// FILES_BACKUP_ALLOW_BROAD_RESTORE=1.
const RESTORE_NARROW_RE = /^(tenants\/[^/]+\/|normative\/|esocial-certificates\/|RAG[^/]*\/[^/]+)/;

class ConfigError extends Error {}

function validPrefix(prefix) {
  if (!KEY_RE.test(prefix) || CONTROL_RE.test(prefix)) return false;
  if (prefix.includes('//')) return false;
  return !prefix.split('/').some((seg) => seg === '..' || seg === '.');
}

// ---------------------------------------------------------------- utilidades

function classifyKey(key) {
  if (typeof key !== 'string' || key.length === 0) return 'invalid';
  if (key.endsWith('/')) return 'marker';
  if (key.startsWith(EXCLUDED_PREFIX)) return 'excluded';
  if (CONTROL_RE.test(key) || Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) return 'invalid';
  if (!KEY_RE.test(key)) return 'not-allowed';
  return 'ok';
}

function normEtag(etag) {
  return String(etag || '').replace(/"/g, '').trim().toLowerCase();
}

function isSimpleEtag(etag) {
  return /^[0-9a-f]{32}$/.test(etag);
}

function isNotFound(err) {
  return Boolean(
    err &&
      (err.name === 'NoSuchKey' || err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)),
  );
}

// Host normalizado para comparar destinos: minúsculas, com porta, sem ponto
// final e sem o prefixo "<bucket>." do endereçamento virtual-host.
function hostKey(endpoint, bucket) {
  const u = new URL(endpoint);
  let host = u.host.toLowerCase().replace(/\.(?=:|$)/, '');
  if (host.startsWith(`${bucket}.`)) host = host.slice(bucket.length + 1);
  return host;
}

function sameTargetStatic(a, b) {
  return a.bucket === b.bucket && hostKey(a.endpoint, a.bucket) === hostKey(b.endpoint, b.bucket);
}

function intEnv(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(String(raw))) throw new ConfigError(`${name} inválida (esperado inteiro entre ${min} e ${max})`);
  const n = Number.parseInt(raw, 10);
  if (n < min || n > max) throw new ConfigError(`${name} fora do intervalo ${min}..${max}`);
  return n;
}

function side(env, vars) {
  return {
    endpoint: env[vars[0]],
    accessKeyId: env[vars[1]],
    secretAccessKey: env[vars[2]],
    bucket: env[vars[3]],
  };
}

function readConfig(env) {
  const missing = [...PROD_VARS, ...BACKUP_VARS].filter((n) => !env[n] || !String(env[n]).trim());
  if (missing.length) {
    throw new ConfigError(`variáveis não definidas: ${missing.join(', ')} (nada foi feito)`);
  }
  for (const name of ['R2_ENDPOINT', 'R2_BACKUP_ENDPOINT']) {
    let u;
    try {
      u = new URL(env[name]);
    } catch {
      throw new ConfigError(`${name} não é uma URL válida`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ConfigError(`${name} precisa ser http(s)`);
    if (u.username || u.password) throw new ConfigError(`${name} não pode conter credencial na URL`);
    if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
      throw new ConfigError(`${name} não pode conter caminho/bucket/query (use só https://host)`);
    }
  }
  for (const name of ['R2_BUCKET', 'R2_BACKUP_BUCKET']) {
    if (!BUCKET_RE.test(env[name])) throw new ConfigError(`${name} não é um nome de bucket válido`);
  }
  const prod = side(env, PROD_VARS);
  const backup = side(env, BACKUP_VARS);
  if (sameTargetStatic(prod, backup)) {
    throw new ConfigError('bucket de backup é o MESMO bucket de produção — recusado (use um bucket dedicado)');
  }
  if (prod.accessKeyId === backup.accessKeyId) {
    throw new ConfigError('credencial do backup é a MESMA da produção — recusado (crie um token separado só para o bucket de backup)');
  }

  const action = env.FILES_BACKUP_ACTION || 'sync';
  if (!ACTIONS.includes(action)) throw new ConfigError(`FILES_BACKUP_ACTION inválida (use ${ACTIONS.join('|')})`);
  const prefix = env.FILES_BACKUP_PREFIX || '';
  if (prefix && !validPrefix(prefix)) {
    throw new ConfigError(
      'FILES_BACKUP_PREFIX precisa começar por um prefixo permitido (tenants/, normative/, esocial-certificates/, RAG.../) e não pode ter "..", "//" nem caracteres de controle',
    );
  }
  const confirm = env.FILES_BACKUP_CONFIRM_BUCKET || '';
  let broadRestore = false;
  if (action === 'restore') {
    if (!prefix) throw new ConfigError('restore exige FILES_BACKUP_PREFIX (restaure o mínimo necessário)');
    if (!RESTORE_NARROW_RE.test(prefix)) {
      if (env.FILES_BACKUP_ALLOW_BROAD_RESTORE !== '1') {
        throw new ConfigError(
          'restore com prefixo amplo recusado: use tenants/<id>/..., normative/..., esocial-certificates/... ou RAG.../<algo>; amplo só com FILES_BACKUP_ALLOW_BROAD_RESTORE=1 (pode ressuscitar arquivos apagados por eliminação LGPD)',
        );
      }
      broadRestore = true;
    }
    if (confirm !== prod.bucket) {
      throw new ConfigError('restore exige FILES_BACKUP_CONFIRM_BUCKET igual ao nome exato do bucket de PRODUÇÃO (R2_BUCKET)');
    }
  }
  if (action === 'init-destination' && confirm !== backup.bucket) {
    throw new ConfigError('init-destination exige FILES_BACKUP_CONFIRM_BUCKET igual ao nome exato do bucket de BACKUP (R2_BACKUP_BUCKET)');
  }
  const restore = action === 'restore';
  return {
    action,
    restore,
    broadRestore,
    dryRun: env.FILES_BACKUP_DRY_RUN === '1',
    onlyMissing: restore || env.FILES_BACKUP_ONLY_MISSING === '1',
    deep: env.FILES_BACKUP_VERIFY_DEEP === '1',
    forcePathStyle: env.FILES_BACKUP_FORCE_PATH_STYLE === '1',
    prefix,
    concurrency: intEnv(env, 'FILES_BACKUP_CONCURRENCY', 4, 1, 16),
    retries: intEnv(env, 'FILES_BACKUP_RETRIES', 3, 0, 10),
    backoffMs: intEnv(env, 'FILES_BACKUP_BACKOFF_MS', 1000, 0, 60000),
    timeoutMs: intEnv(env, 'FILES_BACKUP_TIMEOUT_MS', 300000, 1000, 3600000),
    partSize: intEnv(env, 'FILES_BACKUP_PART_SIZE_MB', 8, 5, 64) * MIB,
    multipartThreshold: intEnv(env, 'FILES_BACKUP_MULTIPART_MB', 8, 5, 1024) * MIB,
    supersededMaxAgeDays: intEnv(env, 'FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS', 0, 0, 36500),
    prod,
    backup,
    // Sentido da cópia: restore troca os papéis.
    src: restore ? backup : prod,
    dst: restore ? prod : backup,
  };
}

// Remove de qualquer mensagem os valores das variáveis (e o host dos
// endpoints, que contém o ID da conta no R2).
function makeRedactor(env) {
  const secrets = [];
  for (const name of [...PROD_VARS, ...BACKUP_VARS]) {
    const v = env[name];
    if (v && String(v).length >= 4) secrets.push([String(v), name]);
    if (v && name.endsWith('ENDPOINT')) {
      try {
        secrets.push([new URL(v).host, `${name}_HOST`]);
        secrets.push([new URL(v).hostname, `${name}_HOST`]);
      } catch {
        /* inválido: readConfig recusa */
      }
    }
  }
  secrets.sort((a, b) => b[0].length - a[0].length);
  return (msg) => {
    let out = String(msg);
    for (const [value, name] of secrets) out = out.split(value).join(`[REDACTED:${name}]`);
    return out;
  };
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function errMessage(err) {
  if (!err) return 'erro desconhecido';
  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  const status = err.$metadata && err.$metadata.httpStatusCode ? ` (HTTP ${err.$metadata.httpStatusCode})` : '';
  return `${name}${err.message || String(err)}${status}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { retries, backoffMs }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err && err.noRetry) break;
      if (attempt < retries && backoffMs > 0) {
        const jitter = Math.floor(Math.random() * backoffMs);
        await sleep(backoffMs * 2 ** attempt + jitter);
      }
    }
  }
  throw lastErr;
}

// Executa fn(signal) com prazo; ao estourar, aborta requisições e streams.
async function withTimeout(ms, fn) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`tempo esgotado (${ms} ms) para o objeto`);
      err.name = 'Timeout';
      ac.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([fn(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

// Divide um stream em partes de partSize bytes (a última pode ser menor).
async function* partsOf(stream, partSize) {
  let chunks = [];
  let len = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    len += buf.length;
    while (len >= partSize) {
      const all = Buffer.concat(chunks, len);
      chunks = [];
      yield all.subarray(0, partSize);
      const rest = Buffer.from(all.subarray(partSize));
      chunks = rest.length ? [rest] : [];
      len = rest.length;
    }
  }
  if (len > 0) yield Buffer.concat(chunks, len);
}

function destroyOnAbort(body, signal) {
  if (!body || typeof body.destroy !== 'function') return;
  if (signal.aborted) body.destroy(signal.reason);
  else signal.addEventListener('abort', () => body.destroy(signal.reason), { once: true });
}

// ------------------------------------------------------------ comparação

function compareListing(src, dst) {
  if (!dst) return 'missing';
  if (dst.size !== src.size) return 'size';
  if (dst.etag === src.etag) return 'equal';
  return 'needs-head';
}

// ETag diferente (ex.: copiado em multipart): confia no metadado gravado por
// nós — ETag da origem + SHA-256 do conteúdo.
function judgeHead(src, head) {
  const meta = lowerKeys((head && head.Metadata) || {});
  if (Number(head.ContentLength) !== src.size) return 'size';
  if (meta[META_SRC_ETAG] === src.etag && /^[0-9a-f]{64}$/.test(meta[META_SHA256] || '')) return 'equal';
  return 'etag';
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k.toLowerCase()] = v;
  return out;
}

// ------------------------------------------------------------------ S3

function makeClient(sdk, s, forcePathStyle) {
  return new sdk.S3Client({
    region: 'auto',
    endpoint: s.endpoint,
    forcePathStyle,
    maxAttempts: 2, // a retentativa principal é a nossa, por objeto
    // Sem CRC32 automático do SDK: mandamos Content-MD5 e conferimos via Head.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
}

async function listAll(ctx, s, prefixes) {
  const items = new Map();
  for (const prefix of prefixes) {
    let token;
    do {
      const res = await withRetry(
        () =>
          withTimeout(ctx.cfg.timeoutMs, (signal) =>
            s.client.send(new ctx.sdk.ListObjectsV2Command({ Bucket: s.bucket, Prefix: prefix, ContinuationToken: token }), {
              abortSignal: signal,
            }),
          ),
        ctx.cfg,
      );
      for (const obj of res.Contents || []) {
        items.set(obj.Key, { size: Number(obj.Size), etag: normEtag(obj.ETag), lastModified: obj.LastModified });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return items;
}

async function headObj(ctx, s, key, signal) {
  return s.client.send(new ctx.sdk.HeadObjectCommand({ Bucket: s.bucket, Key: key }), { abortSignal: signal });
}

async function exists(ctx, s, key) {
  try {
    await withRetry(() => withTimeout(ctx.cfg.timeoutMs, (signal) => headObj(ctx, s, key, signal)), {
      ...ctx.cfg,
      retries: Math.min(ctx.cfg.retries, 2),
    });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isPreconditionFailed(err) {
  return Boolean(err && (err.name === 'PreconditionFailed' || (err.$metadata && err.$metadata.httpStatusCode === 412)));
}

// No restore, 412 na ESCRITA (If-None-Match: *) = objeto criado na produção
// entre a listagem e a gravação: não sobrescrito, sem retentativa, não é falha.
function asCreatedMeanwhile(ctx) {
  return (err) => {
    if (ctx.cfg.restore && isPreconditionFailed(err)) {
      const e = new Error('objeto surgiu no destino depois da listagem — não sobrescrito (If-None-Match)');
      e.name = 'CriadoNoDestino';
      e.createdMeanwhile = true;
      e.noRetry = true;
      throw e;
    }
    throw err;
  };
}

function vanishedError() {
  const err = new Error('objeto sumiu da origem entre a listagem e a leitura');
  err.name = 'SumiuNaOrigem';
  err.vanished = true;
  err.noRetry = true;
  return err;
}

async function getSrc(ctx, key, signal, ifMatch) {
  let res;
  try {
    res = await ctx.src.client.send(new ctx.sdk.GetObjectCommand({ Bucket: ctx.src.bucket, Key: key, IfMatch: ifMatch }), {
      abortSignal: signal,
    });
  } catch (err) {
    if (isNotFound(err)) throw vanishedError();
    throw err;
  }
  destroyOnAbort(res.Body, signal);
  return res;
}

function copyMetadata(get, sha256, srcEtag, size) {
  const meta = {};
  for (const [k, v] of Object.entries(lowerKeys(get.Metadata || {}))) {
    if (!k.startsWith('montese-')) meta[k] = v;
  }
  meta[META_SRC_ETAG] = srcEtag;
  meta[META_SHA256] = sha256;
  meta[META_SRC_SIZE] = String(size);
  return meta;
}

function sourceChanged(msg) {
  const err = new Error(msg);
  err.name = 'OrigemInconsistente';
  return err;
}

async function readAll(stream, maxBytes) {
  const chunks = [];
  let len = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    len += buf.length;
    if (len > maxBytes) throw sourceChanged('objeto maior que o esperado durante a leitura');
    chunks.push(buf);
  }
  return Buffer.concat(chunks, len);
}

async function verifyWritten(ctx, key, expect, signal) {
  const head = await headObj(ctx, ctx.dst, key, signal);
  const meta = lowerKeys(head.Metadata || {});
  if (Number(head.ContentLength) !== expect.size) {
    throw new Error(`conferência pós-cópia: tamanho no destino ${head.ContentLength} ≠ ${expect.size}`);
  }
  if (normEtag(head.ETag) !== expect.etag) throw new Error('conferência pós-cópia: ETag do destino não confere');
  if (meta[META_SHA256] !== expect.sha256) throw new Error('conferência pós-cópia: SHA-256 gravado não confere');
}

async function copySimple(ctx, key, src, signal) {
  const get = await getSrc(ctx, key, signal);
  const srcEtag = normEtag(get.ETag);
  const size = Number(get.ContentLength);
  if (size > ctx.cfg.multipartThreshold) throw sourceChanged('objeto cresceu desde a listagem; refaça na próxima execução');
  const body = await readAll(get.Body, size);
  if (body.length !== size) throw sourceChanged(`leitura incompleta da origem (${body.length} de ${size} bytes)`);
  const md5 = crypto.createHash('md5').update(body).digest();
  const md5hex = md5.toString('hex');
  if (isSimpleEtag(srcEtag) && md5hex !== srcEtag) throw sourceChanged('conteúdo lido não confere com o ETag da origem');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  await ctx.dst.client.send(
    new ctx.sdk.PutObjectCommand({
      Bucket: ctx.dst.bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentMD5: md5.toString('base64'),
      ContentType: get.ContentType || 'application/octet-stream',
      ContentDisposition: get.ContentDisposition,
      Metadata: copyMetadata(get, sha256, srcEtag, size),
      // restore: só cria; se o objeto surgiu na produção depois da listagem,
      // o provedor recusa (412) em vez de sobrescrever.
      IfNoneMatch: ctx.cfg.restore ? '*' : undefined,
    }),
    { abortSignal: signal },
  ).catch(asCreatedMeanwhile(ctx));
  await verifyWritten(ctx, key, { size, etag: md5hex, sha256 }, signal);
  return size;
}

// Objeto grande: 1ª leitura calcula SHA-256/MD5 em streaming (para gravar o
// metadado já na criação); 2ª leitura (If-Match no ETag da 1ª) envia em partes.
async function copyMultipart(ctx, key, src, signal) {
  const { sdk } = ctx;
  const first = await getSrc(ctx, key, signal);
  const srcEtag = normEtag(first.ETag);
  const size = Number(first.ContentLength);
  const h1 = crypto.createHash('sha256');
  const m1 = crypto.createHash('md5');
  let n1 = 0;
  for await (const chunk of first.Body) {
    h1.update(chunk);
    m1.update(chunk);
    n1 += chunk.length;
  }
  if (n1 !== size) throw sourceChanged(`leitura incompleta da origem (${n1} de ${size} bytes)`);
  if (isSimpleEtag(srcEtag) && m1.digest('hex') !== srcEtag) throw sourceChanged('conteúdo lido não confere com o ETag da origem');
  const sha256 = h1.digest('hex');

  const created = await ctx.dst.client.send(
    new sdk.CreateMultipartUploadCommand({
      Bucket: ctx.dst.bucket,
      Key: key,
      ContentType: first.ContentType || 'application/octet-stream',
      ContentDisposition: first.ContentDisposition,
      Metadata: copyMetadata(first, sha256, srcEtag, size),
    }),
    { abortSignal: signal },
  );
  const uploadId = created.UploadId;
  try {
    const second = await getSrc(ctx, key, signal, first.ETag);
    const h2 = crypto.createHash('sha256');
    const parts = [];
    let partNumber = 0;
    let n2 = 0;
    for await (const part of partsOf(second.Body, ctx.cfg.partSize)) {
      partNumber += 1;
      h2.update(part);
      n2 += part.length;
      const res = await ctx.dst.client.send(
        new sdk.UploadPartCommand({
          Bucket: ctx.dst.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: part,
          ContentLength: part.length,
          ContentMD5: crypto.createHash('md5').update(part).digest('base64'),
        }),
        { abortSignal: signal },
      );
      parts.push({ ETag: res.ETag, PartNumber: partNumber });
    }
    if (n2 !== size || h2.digest('hex') !== sha256) throw sourceChanged('origem mudou entre as duas leituras');
    const done = await ctx.dst.client.send(
      new sdk.CompleteMultipartUploadCommand({
        Bucket: ctx.dst.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
        IfNoneMatch: ctx.cfg.restore ? '*' : undefined,
      }),
      { abortSignal: signal },
    ).catch(asCreatedMeanwhile(ctx));
    await verifyWritten(ctx, key, { size, etag: normEtag(done.ETag), sha256 }, signal);
    return size;
  } catch (err) {
    // Abortar o upload incompleto não apaga objeto algum: só descarta partes.
    // Prazo próprio: o sinal do objeto pode já ter estourado.
    await ctx.dst.client
      .send(new sdk.AbortMultipartUploadCommand({ Bucket: ctx.dst.bucket, Key: key, UploadId: uploadId }), {
        abortSignal: AbortSignal.timeout(ABORT_MPU_TIMEOUT_MS),
      })
      .catch(() => undefined);
    throw err;
  }
}

function encodeCopySource(bucket, key) {
  return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
}

function supersededKey(dstEntry, key) {
  const tag = (dstEntry.etag || 'sem-etag').replace(/[^0-9a-z-]/g, '');
  return `${SUPERSEDED_PREFIX}${tag}/${key}`;
}

// Antes de sobrescrever um objeto divergente no backup, preserva a versão
// atual em _superseded/<etag-antigo>/<chave>. Chave determinística + Head:
// se a regravação falhar (ex.: Bucket Lock), a próxima execução reutiliza a
// cópia preservada em vez de criar outra.
async function supersede(ctx, key, dstEntry, signal) {
  const target = supersededKey(dstEntry, key);
  if (Buffer.byteLength(target, 'utf8') > MAX_KEY_BYTES) {
    const err = new Error('chave longa demais para preservar a versão anterior — não sobrescrito');
    err.noRetry = true;
    throw err;
  }
  try {
    const h = await headObj(ctx, ctx.dst, target, signal);
    if (Number(h.ContentLength) === dstEntry.size) return 'reused';
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await ctx.dst.client.send(
    new ctx.sdk.CopyObjectCommand({
      Bucket: ctx.dst.bucket,
      Key: target,
      CopySource: encodeCopySource(ctx.dst.bucket, key),
      CopySourceIfMatch: dstEntry.etag ? `"${dstEntry.etag}"` : undefined,
      MetadataDirective: 'COPY',
    }),
    { abortSignal: signal },
  );
  const head = await headObj(ctx, ctx.dst, target, signal);
  if (Number(head.ContentLength) !== dstEntry.size) throw new Error('versão anterior preservada com tamanho divergente');
  return 'copied';
}

// ------------------------------------------------------------ guardas

async function resolveAll(host, resolver) {
  const res = await resolver(host);
  return new Set(res.map((r) => (typeof r === 'string' ? r : r.address)));
}

function defaultResolver(host) {
  return dns.promises.lookup(host, { all: true });
}

// Resolve os dois hosts (falha clara se o container não tiver rede/DNS) e
// recusa mesmo bucket atrás de IPs em comum.
async function networkGuard(ctx, resolver) {
  const hosts = {};
  for (const [name, s] of [
    ['R2_ENDPOINT', ctx.cfg.prod],
    ['R2_BACKUP_ENDPOINT', ctx.cfg.backup],
  ]) {
    const hostname = new URL(s.endpoint).hostname;
    try {
      hosts[name] = await withRetry(() => resolveAll(hostname, resolver), {
        retries: 2,
        backoffMs: Math.min(ctx.cfg.backoffMs, 1000),
      });
    } catch {
      throw new ConfigError(`não foi possível resolver o host de ${name} (rede/DNS do container efêmero?) — nada foi feito`);
    }
  }
  if (ctx.cfg.prod.bucket === ctx.cfg.backup.bucket) {
    for (const ip of hosts.R2_ENDPOINT) {
      if (hosts.R2_BACKUP_ENDPOINT.has(ip)) {
        throw new ConfigError('bucket de backup tem o MESMO nome do de produção e os endpoints resolvem para o mesmo IP — recusado');
      }
    }
  }
}

// Sentinela: só o bucket de backup tem `_montese-backup-destination`.
async function sentinelGuard(ctx) {
  const prodRole = ctx.cfg.restore ? ctx.dst : ctx.src;
  const backupRole = ctx.cfg.restore ? ctx.src : ctx.dst;
  if (await exists(ctx, prodRole, SENTINEL_KEY)) {
    throw new ConfigError(
      'o bucket de PRODUÇÃO contém o sentinela de backup — produção e backup parecem ser o mesmo bucket (alias) — recusado',
    );
  }
  const action = ctx.cfg.action;
  const needsBackupSentinel = action === 'restore' || (action === 'sync' && !ctx.cfg.dryRun);
  if (!needsBackupSentinel) return;
  if (!(await exists(ctx, backupRole, SENTINEL_KEY))) {
    throw new ConfigError(
      'bucket de backup sem o sentinela _montese-backup-destination — rode FILES_BACKUP_ACTION=init-destination antes (nada foi feito)',
    );
  }
}

// ------------------------------------------------------------ ações

function newReport(ctx) {
  return {
    ok: true,
    action: ctx.cfg.action,
    dryRun: ctx.cfg.dryRun,
    scanned: 0,
    copied: 0,
    skipped: 0,
    failed: 0,
    vanished: 0,
    bytes: 0,
    ignored: 0,
    durationMs: 0,
    failures: [],
  };
}

function pushKey(ctx, report, field, key, motivo) {
  if (!report[field]) report[field] = [];
  if (report[field].length < MAX_LISTED) {
    report[field].push({ key: truncate(key, MAX_KEY_CHARS), motivo: truncate(ctx.redact(motivo), MAX_REASON_CHARS) });
  } else {
    report[`${field}Omitted`] = (report[`${field}Omitted`] || 0) + 1;
  }
}

async function loadListings(ctx, report) {
  const prefixes = ctx.cfg.prefix ? [ctx.cfg.prefix] : LIST_PREFIXES;
  const [srcAll, dstAll] = await Promise.all([listAll(ctx, ctx.src, prefixes), listAll(ctx, ctx.dst, prefixes)]);
  const keys = [];
  for (const key of srcAll.keys()) {
    if (classifyKey(key) === 'ok') keys.push(key);
    else report.ignored += 1;
  }
  keys.sort();
  return { srcAll, dstAll, keys };
}

async function stateOf(ctx, key, src, dst, signal) {
  const c = compareListing(src, dst);
  if (c !== 'needs-head') return c;
  try {
    return judgeHead(src, await headObj(ctx, ctx.dst, key, signal));
  } catch (err) {
    if (isNotFound(err)) return 'missing';
    throw err;
  }
}

const MOTIVO = {
  missing: 'faltando no destino',
  size: 'tamanho diverge da origem',
  etag: 'ETag/SHA-256 diverge da origem',
};

async function sync(ctx) {
  const report = newReport(ctx);
  report.onlyMissing = ctx.cfg.onlyMissing;
  if (!ctx.cfg.restore) {
    report.superseded = 0;
    report.supersededReused = 0;
  }
  if (ctx.cfg.dryRun) {
    report.wouldCopy = 0;
    report.wouldCopyBytes = 0;
  }
  if (ctx.cfg.onlyMissing) report.divergentNotOverwritten = 0;
  if (ctx.cfg.restore) report.createdMeanwhileNotOverwritten = 0;
  if (ctx.cfg.broadRestore) {
    report.aviso = 'restore AMPLO (FILES_BACKUP_ALLOW_BROAD_RESTORE=1): pode ressuscitar arquivos apagados de propósito (ex.: eliminação LGPD)';
  }
  const { srcAll, dstAll, keys } = await loadListings(ctx, report);
  report.scanned = keys.length;

  await pool(keys, ctx.cfg.concurrency, async (key) => {
    const src = srcAll.get(key);
    const dst = dstAll.get(key);
    try {
      const state = await withRetry(
        () => withTimeout(ctx.cfg.timeoutMs, (signal) => stateOf(ctx, key, src, dst, signal)),
        ctx.cfg,
      );
      if (state === 'equal') {
        report.skipped += 1;
        return;
      }
      if (state !== 'missing' && ctx.cfg.onlyMissing) {
        report.divergentNotOverwritten += 1;
        report.skipped += 1;
        pushKey(ctx, report, 'notOverwritten', key, `${MOTIVO[state]} — não sobrescrito`);
        return;
      }
      if (ctx.cfg.dryRun) {
        report.wouldCopy += 1;
        report.wouldCopyBytes += src.size;
        return;
      }
      if (state !== 'missing') {
        // Só no sentido produção → backup (restore é sempre onlyMissing).
        const r = await withRetry(() => withTimeout(ctx.cfg.timeoutMs, (signal) => supersede(ctx, key, dst, signal)), ctx.cfg);
        if (r === 'reused') report.supersededReused += 1;
        else report.superseded += 1;
      }
      const copyFn = src.size > ctx.cfg.multipartThreshold ? copyMultipart : copySimple;
      const bytes = await withRetry(() => withTimeout(ctx.cfg.timeoutMs, (signal) => copyFn(ctx, key, src, signal)), ctx.cfg);
      report.copied += 1;
      report.bytes += bytes;
    } catch (err) {
      if (err && err.vanished) {
        report.vanished += 1;
        return;
      }
      if (err && err.createdMeanwhile) {
        report.createdMeanwhileNotOverwritten += 1;
        report.skipped += 1;
        pushKey(ctx, report, 'notOverwritten', key, err.message);
        return;
      }
      report.failed += 1;
      pushKey(ctx, report, 'failures', key, errMessage(err));
    }
  });
  report.ok = report.failed === 0;
  return report;
}

async function deepCheck(ctx, key, signal) {
  const res = await ctx.dst.client.send(new ctx.sdk.GetObjectCommand({ Bucket: ctx.dst.bucket, Key: key }), {
    abortSignal: signal,
  });
  destroyOnAbort(res.Body, signal);
  const sha = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  let n = 0;
  for await (const chunk of res.Body) {
    sha.update(chunk);
    md5.update(chunk);
    n += chunk.length;
  }
  const etag = normEtag(res.ETag);
  const meta = lowerKeys(res.Metadata || {});
  if (n !== Number(res.ContentLength)) return 'leitura incompleta do destino';
  if (isSimpleEtag(etag) && md5.digest('hex') !== etag) return 'conteúdo do destino não confere com o próprio ETag (corrompido)';
  if (meta[META_SHA256] && sha.digest('hex') !== meta[META_SHA256]) return 'conteúdo do destino não confere com o SHA-256 gravado (corrompido)';
  return null;
}

async function verify(ctx, onlyMissing) {
  const report = newReport(ctx);
  for (const k of ['copied', 'bytes', 'dryRun', 'skipped', 'vanished']) delete report[k];
  report.equal = 0;
  report.missing = 0;
  report.divergent = 0;
  report.extraInDest = 0;
  if (ctx.cfg.deep && !onlyMissing) report.deepChecked = 0;
  const { srcAll, dstAll, keys } = await loadListings(ctx, report);
  report.scanned = keys.length;
  for (const key of dstAll.keys()) {
    if (classifyKey(key) === 'ok' && !srcAll.has(key)) report.extraInDest += 1;
  }

  if (onlyMissing) {
    for (const key of keys) {
      if (!dstAll.has(key)) {
        report.missing += 1;
        pushKey(ctx, report, 'failures', key, MOTIVO.missing);
      }
    }
    report.equal = keys.length - report.missing;
    report.ok = true; // informativo
    return report;
  }

  await pool(keys, ctx.cfg.concurrency, async (key) => {
    const src = srcAll.get(key);
    try {
      const state = await withRetry(
        () => withTimeout(ctx.cfg.timeoutMs, (signal) => stateOf(ctx, key, src, dstAll.get(key), signal)),
        ctx.cfg,
      );
      if (state === 'equal') {
        if (ctx.cfg.deep) {
          const problem = await withRetry(() => withTimeout(ctx.cfg.timeoutMs, (signal) => deepCheck(ctx, key, signal)), ctx.cfg);
          report.deepChecked += 1;
          if (problem) {
            report.divergent += 1;
            pushKey(ctx, report, 'failures', key, problem);
            return;
          }
        }
        report.equal += 1;
      } else if (state === 'missing') {
        report.missing += 1;
        pushKey(ctx, report, 'failures', key, MOTIVO.missing);
      } else {
        report.divergent += 1;
        pushKey(ctx, report, 'failures', key, MOTIVO[state]);
      }
    } catch (err) {
      report.failed += 1;
      pushKey(ctx, report, 'failures', key, errMessage(err));
    }
  });
  report.ok = report.missing === 0 && report.divergent === 0 && report.failed === 0;
  return report;
}

async function initDestination(ctx) {
  const report = { ok: true, action: 'init-destination', dryRun: ctx.cfg.dryRun, created: false, existed: false, failures: [] };
  if (await exists(ctx, ctx.dst, SENTINEL_KEY)) {
    report.existed = true;
    return report;
  }
  if (ctx.cfg.dryRun) return report;
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = Buffer.from(
    `${JSON.stringify({
      montese: 'backup-destination',
      nota: 'NÃO apagar: autoriza ops/r2-files-backup.js a escrever neste bucket',
      nonce,
      criadoEm: new Date().toISOString(),
    })}\n`,
  );
  await ctx.dst.client.send(
    new ctx.sdk.PutObjectCommand({ Bucket: ctx.dst.bucket, Key: SENTINEL_KEY, Body: body, ContentType: 'application/json' }),
  );
  // Se o sentinela "aparecer" na produção, os dois endpoints são o mesmo
  // bucket por alias. Nada é apagado: o sentinela na produção passa a
  // bloquear todas as execuções até alguém removê-lo pelo painel.
  if (await exists(ctx, ctx.src, SENTINEL_KEY)) {
    throw new ConfigError(
      'o sentinela gravado no backup apareceu na PRODUÇÃO: é o mesmo bucket (alias). Remova _montese-backup-destination da produção pelo painel e corrija R2_BACKUP_*',
    );
  }
  report.created = true;
  return report;
}

async function listSuperseded(ctx) {
  const items = await listAll(ctx, ctx.dst, [SUPERSEDED_PREFIX]);
  const report = { ok: true, action: 'list-superseded', count: items.size, bytes: 0, failures: [] };
  const maxAge = ctx.cfg.supersededMaxAgeDays;
  const cutoff = maxAge > 0 ? Date.now() - maxAge * 86400000 : null;
  if (cutoff !== null) {
    report.olderThanDays = maxAge;
    report.olderCount = 0;
    report.olderBytes = 0;
  }
  report.items = [];
  for (const [key, o] of [...items.entries()].sort()) {
    report.bytes += o.size;
    const lm = o.lastModified ? new Date(o.lastModified).getTime() : null;
    const old = cutoff !== null && lm !== null && lm < cutoff;
    if (old) {
      report.olderCount += 1;
      report.olderBytes += o.size;
    }
    if ((cutoff === null || old) && report.items.length < MAX_LISTED) {
      report.items.push({ key: truncate(key, MAX_KEY_CHARS), size: o.size, lastModified: lm ? new Date(lm).toISOString() : null });
    }
  }
  report.nota = 'somente listagem; limpeza é decisão do dono (painel/lifecycle do bucket)';
  return report;
}

function startRssSampler() {
  let peak = process.memoryUsage().rss;
  const t = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 200);
  t.unref();
  return () => {
    clearInterval(t);
    return Math.round((Math.max(peak, process.memoryUsage().rss) / MIB) * 10) / 10;
  };
}

// Ponto de entrada testável. options.clients = { prod, backup } (fakes nos
// testes); options.resolver = função de DNS (testes).
async function run(env, options = {}) {
  const started = Date.now();
  const stopRss = startRssSampler();
  const redact = makeRedactor(env);
  let report;
  try {
    const cfg = readConfig(env);
    const sdk = options.sdk || require('@aws-sdk/client-s3');
    const clients = options.clients || {
      prod: makeClient(sdk, cfg.prod, cfg.forcePathStyle),
      backup: makeClient(sdk, cfg.backup, cfg.forcePathStyle),
    };
    const ctx = {
      cfg,
      sdk,
      redact,
      src: { client: cfg.restore ? clients.backup : clients.prod, bucket: cfg.src.bucket },
      dst: { client: cfg.restore ? clients.prod : clients.backup, bucket: cfg.dst.bucket },
    };
    await networkGuard(ctx, options.resolver || defaultResolver);
    if (cfg.action !== 'list-superseded') await sentinelGuard(ctx);
    if (cfg.action === 'sync' || cfg.action === 'restore') report = await sync(ctx);
    else if (cfg.action === 'init-destination') report = await initDestination(ctx);
    else if (cfg.action === 'list-superseded') report = await listSuperseded(ctx);
    else report = await verify(ctx, cfg.action === 'list-missing');
  } catch (err) {
    report = {
      ok: false,
      action: env.FILES_BACKUP_ACTION || 'sync',
      error: truncate(redact(errMessage(err)), MAX_REASON_CHARS),
      failures: [],
    };
  }
  report.durationMs = Date.now() - started;
  report.rssPeakMb = stopRss();
  return report;
}

function main() {
  const finish = (code, line, errLine) => {
    if (errLine) process.stderr.write(`${errLine}\n`);
    // Sai explicitamente depois de escrever a linha: nenhuma promise ou
    // socket pendente segura o processo.
    process.stdout.write(`${line}\n`, () => process.exit(code));
  };
  run(process.env).then(
    (report) => finish(report.ok ? 0 : 1, JSON.stringify(report), report.error ? `[r2-files-backup] ERRO: ${report.error}` : null),
    (err) =>
      finish(
        1,
        JSON.stringify({ ok: false, error: 'erro inesperado', failures: [] }),
        `[r2-files-backup] ERRO inesperado: ${err && err.name ? err.name : 'erro'}`,
      ),
  );
}

if (require.main === module) main();

module.exports = {
  run,
  readConfig,
  classifyKey,
  compareListing,
  judgeHead,
  normEtag,
  partsOf,
  encodeCopySource,
  makeRedactor,
  hostKey,
  supersededKey,
  KEY_RE,
  EXCLUDED_PREFIX,
  SUPERSEDED_PREFIX,
  SENTINEL_KEY,
  ConfigError,
};
