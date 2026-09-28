'use strict';
// Cópia externa dos backups do Postgres para o Cloudflare R2 (ITEM 007 da
// auditoria 2026-09-27). Roda DENTRO do container montese_backend — ele já tem
// @aws-sdk/client-s3 e as variáveis R2_* — chamado por ops/backup-postgres.sh.
//
// Ações (env BACKUP_ACTION): put | prune | list | get
//   put   — lê o dump da stdin, envia para BACKUP_KEY e confere tamanho + MD5
//   prune — apaga os mais antigos além de BACKUP_KEEP (BACKUP_DRY_RUN=1 só lista)
//   list  — lista o que existe sob o prefixo de backups
//   get   — escreve na stdout o objeto BACKUP_KEY (usado no teste de restauração)
//
// Segurança: só toca em chaves que casam KEY_RE (backups/postgres/montese-*.dump).
// Nunca lista nem apaga nada fora desse prefixo/padrão, então não alcança os
// documentos dos clientes que vivem no mesmo bucket.

const crypto = require('crypto');

const PREFIX = 'backups/postgres/';
const KEY_RE = /^backups\/postgres\/montese-\d{8}-\d{6}\.dump$/;

// O timestamp no nome (YYYYMMDD-HHMMSS) ordena cronologicamente como texto.
function selectKeysToPrune(keys, keep) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`BACKUP_KEEP inválido: ${keep} (precisa ser inteiro >= 1)`);
  }
  const valid = keys.filter((key) => KEY_RE.test(key)).sort();
  if (valid.length <= keep) return [];
  return valid.slice(0, valid.length - keep);
}

function getS3() {
  const { S3Client } = require('@aws-sdk/client-s3');
  for (const name of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    if (!process.env[name]) throw new Error(`${name} não definida no ambiente`);
  }
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function requireBackupKey() {
  const key = process.env.BACKUP_KEY;
  if (!key || !KEY_RE.test(key)) {
    throw new Error(`BACKUP_KEY inválida (esperado ${KEY_RE}): ${key}`);
  }
  return key;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function listKeys(s3) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const items = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: PREFIX, ContinuationToken: token }),
    );
    for (const obj of res.Contents || []) items.push({ key: obj.Key, size: obj.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return items;
}

async function put() {
  const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const key = requireBackupKey();
  const body = await readStdin();
  if (body.length === 0) throw new Error('dump vazio na stdin — nada enviado');
  const md5 = crypto.createHash('md5').update(body).digest('hex');

  const s3 = getS3();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    }),
  );

  // Confere no destino, não só "o PutObject não deu erro".
  const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  const remoteEtag = String(head.ETag || '').replace(/"/g, '');
  if (head.ContentLength !== body.length) {
    throw new Error(`tamanho divergente no R2: enviado ${body.length}, remoto ${head.ContentLength}`);
  }
  if (remoteEtag !== md5) {
    throw new Error(`MD5 divergente no R2: enviado ${md5}, remoto ${remoteEtag}`);
  }
  console.log(JSON.stringify({ ok: true, key, bytes: body.length, md5 }));
}

async function prune() {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const keep = Number.parseInt(process.env.BACKUP_KEEP || '30', 10);
  const dryRun = process.env.BACKUP_DRY_RUN === '1';
  const s3 = getS3();
  const items = await listKeys(s3);
  const toDelete = selectKeysToPrune(items.map((item) => item.key), keep);
  for (const key of toDelete) {
    if (!dryRun) await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  }
  console.log(JSON.stringify({ ok: true, dryRun, keep, total: items.length, deleted: toDelete }));
}

async function list() {
  const items = await listKeys(getS3());
  console.log(JSON.stringify({ ok: true, count: items.length, items }));
}

async function get() {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const key = requireBackupKey();
  const res = await getS3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  for await (const chunk of res.Body) process.stdout.write(chunk);
}

async function main() {
  const action = process.env.BACKUP_ACTION;
  const actions = { put, prune, list, get };
  if (!actions[action]) throw new Error(`BACKUP_ACTION inválida: ${action} (use put|prune|list|get)`);
  await actions[action]();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[r2-backup] ERRO: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = { selectKeysToPrune, KEY_RE, PREFIX };
