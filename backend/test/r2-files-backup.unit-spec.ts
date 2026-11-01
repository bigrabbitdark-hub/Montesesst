import { createHash } from 'crypto';
import { Readable } from 'stream';
import * as sdk from '@aws-sdk/client-s3';

// Testa ops/r2-files-backup.js (helper de ops em CommonJS) com clientes S3
// FALSOS em memória — sem rede, sem credencial real. Produção e backup são
// fakes separados; o de produção LANÇA em qualquer escrita (prova de que o
// sentido normal só lê). O ensaio com MinIO de verdade está em
// docs/operations/backups.md.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const backup = require('../../ops/r2-files-backup.js');

type Obj = { body: Buffer; etag: string; meta: Record<string, string>; contentType?: string; lastModified: Date };

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const WRITE_CMDS = /^(PutObject|CopyObject|DeleteObject|CreateMultipartUpload|UploadPart|CompleteMultipartUpload|AbortMultipartUpload)/;

function s3err(name: string, status: number) {
  const err: any = new Error(name);
  err.name = name;
  err.$metadata = { httpStatusCode: status };
  return err;
}

class FakeS3 {
  buckets = new Map<string, Map<string, Obj>>();
  calls: string[] = [];
  uploads = new Map<string, { key: string; meta: Record<string, string>; parts: Map<number, Buffer> }>();
  readOnly = false;
  failGetFor = new Set<string>();
  failPutFor = new Set<string>();
  failUploadPartAt = 0;
  ifNoneMatchSeen: string[] = [];
  onGet?: (input: any) => void;

  constructor(readonly label: string) {}

  bucket(name: string) {
    if (!this.buckets.has(name)) this.buckets.set(name, new Map());
    return this.buckets.get(name)!;
  }

  put(bucket: string, key: string, body: Buffer, meta: Record<string, string> = {}) {
    this.bucket(bucket).set(key, { body, etag: md5(body), meta, lastModified: new Date() });
  }

  writes() {
    return this.calls.filter((c) => WRITE_CMDS.test(c));
  }

  async send(cmd: any): Promise<any> {
    const name = cmd.constructor.name.replace(/Command$/, '');
    const i = cmd.input;
    this.calls.push(`${name}:${i.Bucket}:${i.Key ?? ''}`);
    if (this.readOnly && WRITE_CMDS.test(name)) {
      throw new Error(`ESCRITA PROIBIDA no fake ${this.label}: ${name}`);
    }
    const b = this.bucket(i.Bucket);
    switch (name) {
      case 'ListObjectsV2': {
        const all = [...b.keys()].filter((k) => !i.Prefix || k.startsWith(i.Prefix)).sort();
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
        const page = all.slice(start, start + 3); // paginação pequena de propósito
        const more = start + 3 < all.length;
        return {
          Contents: page.map((k) => ({
            Key: k,
            Size: b.get(k)!.body.length,
            ETag: `"${b.get(k)!.etag}"`,
            LastModified: b.get(k)!.lastModified,
          })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + 3) : undefined,
        };
      }
      case 'HeadObject': {
        const o = b.get(i.Key);
        if (!o) throw s3err('NotFound', 404);
        return { ContentLength: o.body.length, ETag: `"${o.etag}"`, Metadata: { ...o.meta } };
      }
      case 'GetObject': {
        if (this.onGet) this.onGet(i);
        if (this.failGetFor.has(i.Key)) throw new Error('falha simulada de rede');
        const o = b.get(i.Key);
        if (!o) throw s3err('NoSuchKey', 404);
        if (i.IfMatch && i.IfMatch.replace(/"/g, '') !== o.etag) throw s3err('PreconditionFailed', 412);
        const chunks: Buffer[] = [];
        for (let p = 0; p < o.body.length; p += 1024 * 1024) chunks.push(o.body.subarray(p, p + 1024 * 1024));
        return {
          Body: Readable.from(chunks),
          ContentLength: o.body.length,
          ETag: `"${o.etag}"`,
          Metadata: { ...o.meta },
          ContentType: o.contentType,
        };
      }
      case 'PutObject': {
        if (this.failPutFor.has(i.Key)) throw s3err('AccessDenied', 403); // ex.: Bucket Lock
        this.ifNoneMatchSeen.push(`Put:${i.Key}:${i.IfNoneMatch ?? '-'}`);
        if (i.IfNoneMatch === '*' && b.has(i.Key)) throw s3err('PreconditionFailed', 412);
        const body = Buffer.from(i.Body);
        if (i.ContentMD5 && Buffer.from(i.ContentMD5, 'base64').toString('hex') !== md5(body)) throw new Error('BadDigest');
        b.set(i.Key, { body, etag: md5(body), meta: { ...(i.Metadata || {}) }, contentType: i.ContentType, lastModified: new Date() });
        return { ETag: `"${md5(body)}"` };
      }
      case 'CopyObject': {
        const [srcBucket, ...rest] = String(i.CopySource).split('/');
        const srcKey = decodeURIComponent(rest.join('/'));
        const o = this.bucket(srcBucket).get(srcKey);
        if (!o) throw s3err('NoSuchKey', 404);
        if (i.CopySourceIfMatch && i.CopySourceIfMatch.replace(/"/g, '') !== o.etag) throw s3err('PreconditionFailed', 412);
        b.set(i.Key, { ...o, body: Buffer.from(o.body), meta: { ...o.meta }, lastModified: new Date() });
        return {};
      }
      case 'CreateMultipartUpload': {
        const id = `up-${Math.random().toString(16).slice(2)}`;
        this.uploads.set(id, { key: i.Key, meta: { ...(i.Metadata || {}) }, parts: new Map() });
        return { UploadId: id };
      }
      case 'UploadPart': {
        if (this.failUploadPartAt && i.PartNumber === this.failUploadPartAt) throw s3err('InternalError', 500);
        const body = Buffer.from(i.Body);
        this.uploads.get(i.UploadId)!.parts.set(i.PartNumber, body);
        return { ETag: `"${md5(body)}"` };
      }
      case 'CompleteMultipartUpload': {
        const up = this.uploads.get(i.UploadId)!;
        this.ifNoneMatchSeen.push(`Complete:${up.key}:${i.IfNoneMatch ?? '-'}`);
        if (i.IfNoneMatch === '*' && b.has(up.key)) throw s3err('PreconditionFailed', 412);
        const bufs = i.MultipartUpload.Parts.map((p: any) => up.parts.get(p.PartNumber)!);
        const etag = `${createHash('md5')
          .update(Buffer.concat(bufs.map((x: Buffer) => createHash('md5').update(x).digest())))
          .digest('hex')}-${bufs.length}`;
        b.set(up.key, { body: Buffer.concat(bufs), etag, meta: up.meta, lastModified: new Date() });
        this.uploads.delete(i.UploadId);
        return { ETag: `"${etag}"` };
      }
      case 'AbortMultipartUpload':
        this.uploads.delete(i.UploadId);
        return {};
      default:
        throw new Error(`comando não suportado pelo fake: ${name}`);
    }
  }
}

const PROD = 'montese-prod';
const BKP = 'montese-files-backup';
const SENTINEL = '_montese-backup-destination';
const RAG_KEY = 'RAG MONTESESST/Arquivos pdf/Ação de saúde ocupacional.pdf';

function baseEnv(extra: Record<string, string> = {}) {
  return {
    R2_ENDPOINT: 'https://conta-origem.r2.example.com',
    R2_ACCESS_KEY_ID: 'chave-origem-xyz',
    R2_SECRET_ACCESS_KEY: 'segredo-origem-xyz',
    R2_BUCKET: PROD,
    R2_BACKUP_ENDPOINT: 'https://conta-origem.r2.example.com',
    R2_BACKUP_ACCESS_KEY_ID: 'chave-backup-abc',
    R2_BACKUP_SECRET_ACCESS_KEY: 'segredo-backup-abc',
    R2_BACKUP_BUCKET: BKP,
    FILES_BACKUP_BACKOFF_MS: '0',
    FILES_BACKUP_RETRIES: '1',
    ...extra,
  };
}

// DNS falso: cada host resolve para um IP próprio (não há rede nos testes).
const distinctDns = async (host: string) => [{ address: `10.0.0.${host.length}`, family: 4 }];

function setup({ sentinel = true } = {}) {
  const prod = new FakeS3('produção');
  const bkp = new FakeS3('backup');
  prod.put(PROD, 'tenants/t1/documents/a.pdf', Buffer.from('documento A'));
  prod.put(PROD, 'tenants/t1/epi-fichas/e1/v1.pdf', Buffer.from('ficha EPI assinada'));
  prod.put(PROD, 'esocial-certificates/c1.pfx.enc', Buffer.from('cifrado'));
  prod.put(PROD, 'normative/nr-01/x/NR-01.pdf', Buffer.from('norma'));
  prod.put(PROD, RAG_KEY, Buffer.from('rag com acento'));
  prod.put(PROD, 'backups/postgres/montese-20261028-030000.dump', Buffer.from('dump do banco'));
  prod.put(PROD, 'tenants/t1/documents/', Buffer.alloc(0)); // marcador de "pasta"
  prod.put(PROD, 'outro/qualquer.txt', Buffer.from('fora da lista'));
  prod.put(PROD, 'RAGsolto.txt', Buffer.from('sem barra'));
  if (sentinel) bkp.put(BKP, SENTINEL, Buffer.from('{}'));
  prod.readOnly = true; // sentido normal: produção nunca recebe escrita
  return { prod, bkp };
}

const run = (
  s: { prod: FakeS3; bkp: FakeS3 },
  extra: Record<string, string> = {},
  resolver: (h: string) => Promise<any[]> = distinctDns,
) => backup.run(baseEnv(extra), { sdk, clients: { prod: s.prod, backup: s.bkp }, resolver });

const dataKeys = (f: FakeS3, bucket: string) => [...f.bucket(bucket).keys()].filter((k) => k !== SENTINEL);

describe('ops/r2-files-backup.js', () => {
  it('sync copia o que falta (espaço/acento), exclui backups/, marcadores e fora da lista; produção só é lida', async () => {
    const s = setup();
    const r = await run(s);
    expect(r).toMatchObject({ ok: true, scanned: 5, copied: 5, failed: 0, vanished: 0 });
    expect(r.ignored).toBe(2); // marcador + 'RAGsolto.txt' (backups/ e outro/ nem são listados)
    expect(dataKeys(s.bkp, BKP).sort()).toEqual(
      [RAG_KEY, 'esocial-certificates/c1.pfx.enc', 'normative/nr-01/x/NR-01.pdf', 'tenants/t1/documents/a.pdf', 'tenants/t1/epi-fichas/e1/v1.pdf'].sort(),
    );
    expect(s.bkp.bucket(BKP).get(RAG_KEY)!.body.toString()).toBe('rag com acento');
    expect(s.bkp.bucket(BKP).get('tenants/t1/documents/a.pdf')!.meta['montese-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(s.prod.writes()).toEqual([]);
    expect(s.prod.calls.some((c) => c.includes('backups/') || c.includes('outro/'))).toBe(false);
    expect(typeof r.rssPeakMb).toBe('number');
  });

  it('segunda execução pula tudo (idempotente)', async () => {
    const s = setup();
    await run(s);
    s.bkp.calls = [];
    const r = await run(s);
    expect(r).toMatchObject({ ok: true, copied: 0, skipped: 5, failed: 0 });
    expect(s.bkp.writes()).toEqual([]);
  });

  it('divergência de tamanho e conteúdo: preserva versão antiga em _superseded/<etag>/ e recopia', async () => {
    const s = setup();
    await run(s);
    s.bkp.put(BKP, 'tenants/t1/documents/a.pdf', Buffer.from('truncado'));
    s.bkp.put(BKP, 'normative/nr-01/x/NR-01.pdf', Buffer.from('NORMA'));
    const v = await run(s, { FILES_BACKUP_ACTION: 'verify' });
    expect(v).toMatchObject({ ok: false, divergent: 2, missing: 0 });
    expect(v.failures.map((f: any) => f.motivo).sort()).toEqual(['ETag/SHA-256 diverge da origem', 'tamanho diverge da origem']);
    const r = await run(s);
    expect(r).toMatchObject({ ok: true, copied: 2, superseded: 2, supersededReused: 0, skipped: 3 });
    expect(s.bkp.bucket(BKP).get('tenants/t1/documents/a.pdf')!.body.toString()).toBe('documento A');
    const preserved = dataKeys(s.bkp, BKP).filter((k) => k.startsWith('_superseded/'));
    expect(preserved.sort()).toEqual(
      [`_superseded/${md5(Buffer.from('NORMA'))}/normative/nr-01/x/NR-01.pdf`, `_superseded/${md5(Buffer.from('truncado'))}/tenants/t1/documents/a.pdf`].sort(),
    );
    expect(s.bkp.bucket(BKP).get(preserved.find((k) => k.endsWith('a.pdf'))!)!.body.toString()).toBe('truncado');
    expect((await run(s, { FILES_BACKUP_ACTION: 'verify' })).ok).toBe(true);
  });

  it('falha repetida na regravação (ex.: Bucket Lock) NÃO faz _superseded crescer', async () => {
    const s = setup();
    await run(s);
    s.bkp.put(BKP, 'tenants/t1/documents/a.pdf', Buffer.from('versão velha'));
    s.bkp.failPutFor.add('tenants/t1/documents/a.pdf');
    const r1 = await run(s);
    const r2 = await run(s);
    const r3 = await run(s);
    expect(r1).toMatchObject({ ok: false, failed: 1, superseded: 1, supersededReused: 0 });
    expect(r2).toMatchObject({ ok: false, failed: 1, superseded: 0, supersededReused: 1 });
    expect(r3).toMatchObject({ ok: false, failed: 1, superseded: 0, supersededReused: 1 });
    expect(dataKeys(s.bkp, BKP).filter((k) => k.startsWith('_superseded/'))).toHaveLength(1);
    expect(s.bkp.calls.filter((c) => c.startsWith('CopyObject'))).toHaveLength(1);
  });

  it('nunca apaga extras no destino', async () => {
    const s = setup();
    s.bkp.put(BKP, 'tenants/t9/documents/so-no-backup.pdf', Buffer.from('apagado na origem'));
    const r = await run(s);
    expect(r.ok).toBe(true);
    expect(s.bkp.bucket(BKP).has('tenants/t9/documents/so-no-backup.pdf')).toBe(true);
    expect([...s.bkp.calls, ...s.prod.calls].some((c) => c.startsWith('DeleteObject'))).toBe(false);
    expect(await run(s, { FILES_BACKUP_ACTION: 'verify' })).toMatchObject({ ok: true, extraInDest: 1 });
  });

  it.each([
    ['barra final e maiúsculas', { R2_BACKUP_BUCKET: PROD, R2_BACKUP_ENDPOINT: 'https://CONTA-ORIGEM.r2.example.com/' }, /MESMO bucket/],
    ['virtual-host com o bucket no host', { R2_BACKUP_BUCKET: PROD, R2_BACKUP_ENDPOINT: 'https://montese-prod.conta-origem.r2.example.com' }, /MESMO bucket/],
    ['ponto final no host', { R2_BACKUP_BUCKET: PROD, R2_BACKUP_ENDPOINT: 'https://conta-origem.r2.example.com.' }, /MESMO bucket/],
    ['bucket embutido no caminho', { R2_BACKUP_ENDPOINT: 'https://conta-origem.r2.example.com/montese-prod' }, /não pode conter caminho/],
    ['credencial repetida', { R2_BACKUP_ACCESS_KEY_ID: 'chave-origem-xyz' }, /MESMA da produção/],
  ])('recusa destino igual à origem: %s — sem nenhuma chamada', async (_label, extra, msg) => {
    const s = setup();
    const r = await run(s, extra as Record<string, string>);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
    expect([...s.prod.calls, ...s.bkp.calls]).toEqual([]);
  });

  it('recusa alias de DNS: mesmo nome de bucket em hosts diferentes que resolvem para o mesmo IP', async () => {
    const s = setup();
    const sameIp = async () => [{ address: '203.0.113.7', family: 4 }];
    const r = await run(s, { R2_BACKUP_BUCKET: PROD, R2_BACKUP_ENDPOINT: 'https://alias.example.net' }, sameIp);
    expect(r.error).toMatch(/resolvem para o mesmo IP/);
    expect([...s.prod.calls, ...s.bkp.calls]).toEqual([]);
  });

  it('DNS que não resolve: falha clara, sem nenhuma chamada', async () => {
    const s = setup();
    const r = await run(s, {}, async () => {
      throw new Error('ENOTFOUND');
    });
    expect(r.error).toMatch(/não foi possível resolver o host de R2_ENDPOINT/);
    expect([...s.prod.calls, ...s.bkp.calls]).toEqual([]);
  });

  it('variáveis ausentes: recusa sem imprimir valores', async () => {
    const s = setup();
    const env: any = baseEnv();
    delete env.R2_BACKUP_SECRET_ACCESS_KEY;
    delete env.R2_BACKUP_BUCKET;
    const r = await backup.run(env, { sdk, clients: { prod: s.prod, backup: s.bkp }, resolver: distinctDns });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('R2_BACKUP_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET');
    for (const secret of ['chave-origem-xyz', 'segredo-origem-xyz', 'segredo-backup-abc', 'conta-origem']) {
      expect(JSON.stringify(r)).not.toContain(secret);
    }
    expect([...s.prod.calls, ...s.bkp.calls]).toEqual([]);
  });

  it('sentinela: sync sem sentinela recusa sem escrever; dry-run e verify funcionam sem ele', async () => {
    const s = setup({ sentinel: false });
    const r = await run(s);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sem o sentinela/);
    expect(s.bkp.writes()).toEqual([]);
    expect(await run(s, { FILES_BACKUP_DRY_RUN: '1' })).toMatchObject({ ok: true, wouldCopy: 5, copied: 0 });
    expect(await run(s, { FILES_BACKUP_ACTION: 'list-missing' })).toMatchObject({ ok: true, missing: 5 });
    expect(s.bkp.writes()).toEqual([]);
  });

  it('init-destination: exige confirmação, grava uma vez, é idempotente e libera o sync', async () => {
    const s = setup({ sentinel: false });
    const semConfirmacao = await run(s, { FILES_BACKUP_ACTION: 'init-destination' });
    expect(semConfirmacao.error).toMatch(/FILES_BACKUP_CONFIRM_BUCKET/);
    const errado = await run(s, { FILES_BACKUP_ACTION: 'init-destination', FILES_BACKUP_CONFIRM_BUCKET: PROD });
    expect(errado.ok).toBe(false);
    expect(s.bkp.writes()).toEqual([]);
    const ok = { FILES_BACKUP_ACTION: 'init-destination', FILES_BACKUP_CONFIRM_BUCKET: BKP };
    expect(await run(s, ok)).toMatchObject({ ok: true, created: true, existed: false });
    expect(await run(s, ok)).toMatchObject({ ok: true, created: false, existed: true });
    expect(s.bkp.writes()).toEqual([`PutObject:${BKP}:${SENTINEL}`]);
    expect(await run(s)).toMatchObject({ ok: true, copied: 5 });
  });

  it('sentinela pega alias que escapa da normalização (mesmo bucket físico por outro host)', async () => {
    const shared = new FakeS3('mesmo bucket físico');
    shared.put(PROD, 'tenants/t1/documents/a.pdf', Buffer.from('doc'));
    const env = { R2_BACKUP_BUCKET: PROD, R2_BACKUP_ENDPOINT: 'https://outro-nome.example.net' };
    const go = (extra: Record<string, string>) =>
      backup.run(baseEnv({ ...env, ...extra }), { sdk, clients: { prod: shared, backup: shared }, resolver: distinctDns });
    const init = await go({ FILES_BACKUP_ACTION: 'init-destination', FILES_BACKUP_CONFIRM_BUCKET: PROD });
    expect(init.ok).toBe(false);
    expect(init.error).toMatch(/apareceu na PRODUÇÃO/);
    const r = await go({});
    expect(r.error).toMatch(/PRODUÇÃO contém o sentinela/);
    expect(shared.writes()).toEqual([`PutObject:${PROD}:${SENTINEL}`]); // só o sentinela, nada mais
  });

  it('dry-run não escreve nada e relata o que copiaria', async () => {
    const s = setup();
    const r = await run(s, { FILES_BACKUP_DRY_RUN: '1' });
    expect(r).toMatchObject({ ok: true, dryRun: true, copied: 0, wouldCopy: 5 });
    expect(r.wouldCopyBytes).toBeGreaterThan(0);
    expect(s.bkp.writes()).toEqual([]);
  });

  it('falha de leitura é reportada (ok=false) sem derrubar os demais', async () => {
    const s = setup();
    s.prod.failGetFor.add('tenants/t1/documents/a.pdf');
    const r = await run(s);
    expect(r).toMatchObject({ ok: false, copied: 4, failed: 1 });
    expect(r.failures).toEqual([{ key: 'tenants/t1/documents/a.pdf', motivo: 'falha simulada de rede' }]);
  });

  it('objeto que some da origem entre listagem e leitura conta em vanished, sem retentativa', async () => {
    const s = setup();
    s.prod.onGet = (i) => {
      if (i.Key === 'tenants/t1/documents/a.pdf') s.prod.bucket(PROD).delete(i.Key);
    };
    const r = await run(s, { FILES_BACKUP_RETRIES: '3' });
    expect(r).toMatchObject({ ok: true, copied: 4, failed: 0, vanished: 1 });
    expect(s.prod.calls.filter((c) => c === `GetObject:${PROD}:tenants/t1/documents/a.pdf`)).toHaveLength(1);
  });

  it('mensagens de erro são higienizadas (endpoint/bucket/chave viram [REDACTED])', async () => {
    const s = setup();
    s.prod.send = async () => {
      throw new Error('falhou em https://conta-origem.r2.example.com/montese-prod com chave-backup-abc');
    };
    const r = await run(s);
    expect(r.ok).toBe(false);
    expect(r.error).not.toMatch(/conta-origem|montese-prod|chave-backup-abc/);
    expect(r.error).toContain('[REDACTED:');
  });

  const BIG = 'normative/grande/manual com espaço.pdf';
  const MP = { FILES_BACKUP_MULTIPART_MB: '5', FILES_BACKUP_PART_SIZE_MB: '5' };
  function bigBuffer(seed: number) {
    const big = Buffer.alloc(11 * 1024 * 1024 + 123);
    for (let p = 0; p < big.length; p += 4096) big[p] = (p + seed) % 251;
    return big;
  }

  it('objeto grande vai em multipart com SHA-256 gravado; reexecução reconhece; corrupção é detectada', async () => {
    const s = setup();
    const big = bigBuffer(1);
    s.prod.put(PROD, BIG, big);
    expect(await run(s, MP)).toMatchObject({ ok: true, copied: 6 });
    const copied = s.bkp.bucket(BKP).get(BIG)!;
    expect(copied.etag).toMatch(/-3$/);
    expect(copied.body.equals(big)).toBe(true);
    expect(copied.meta['montese-sha256']).toBe(createHash('sha256').update(big).digest('hex'));
    expect(await run(s, MP)).toMatchObject({ ok: true, copied: 0, skipped: 6 });
    const bad = Buffer.from(big);
    bad[10] ^= 0xff;
    s.bkp.put(BKP, BIG, bad);
    expect(await run(s, { ...MP, FILES_BACKUP_ACTION: 'verify' })).toMatchObject({ ok: false, divergent: 1 });
  });

  it('falha no meio do multipart aborta o upload (sem objeto parcial nem upload pendente)', async () => {
    const s = setup();
    s.prod.put(PROD, BIG, bigBuffer(2));
    s.bkp.failUploadPartAt = 2;
    const r = await run(s, { ...MP, FILES_BACKUP_RETRIES: '1' });
    expect(r).toMatchObject({ ok: false, failed: 1, copied: 5 });
    expect(s.bkp.bucket(BKP).has(BIG)).toBe(false);
    expect(s.bkp.uploads.size).toBe(0);
    expect(s.bkp.calls.filter((c) => c.startsWith('AbortMultipartUpload'))).toHaveLength(2);
  });

  it('origem muda entre as duas leituras do multipart: If-Match falha e a retentativa copia a versão nova', async () => {
    const s = setup();
    s.prod.put(PROD, BIG, bigBuffer(3));
    const novo = bigBuffer(4);
    let mudou = false;
    s.prod.onGet = (i) => {
      if (i.Key === BIG && i.IfMatch && !mudou) {
        mudou = true;
        s.prod.bucket(PROD).set(BIG, { body: novo, etag: md5(novo), meta: {}, lastModified: new Date() });
      }
    };
    const r = await run(s, { ...MP, FILES_BACKUP_RETRIES: '2' });
    expect(r).toMatchObject({ ok: true, copied: 6, failed: 0 });
    expect(s.bkp.bucket(BKP).get(BIG)!.body.equals(novo)).toBe(true);
    expect(s.bkp.uploads.size).toBe(0);
  });

  it('verify profundo acusa corrupção silenciosa que a listagem não vê', async () => {
    const s = setup();
    await run(s);
    s.bkp.bucket(BKP).get('esocial-certificates/c1.pfx.enc')!.body = Buffer.from('CIFRADO');
    expect((await run(s, { FILES_BACKUP_ACTION: 'verify' })).ok).toBe(true);
    const deep = await run(s, { FILES_BACKUP_ACTION: 'verify', FILES_BACKUP_VERIFY_DEEP: '1' });
    expect(deep).toMatchObject({ ok: false, divergent: 1, deepChecked: 5 });
    expect(deep.failures[0].motivo).toMatch(/corrompido/);
  });

  describe('restore (backup → produção)', () => {
    async function prepared() {
      const s = setup();
      await run(s);
      s.prod.readOnly = false;
      s.bkp.readOnly = true; // no restore o backup só pode ser lido
      s.prod.bucket(PROD).delete('tenants/t1/documents/a.pdf');
      s.prod.put(PROD, 'tenants/t1/epi-fichas/e1/v1.pdf', Buffer.from('versão nova na produção'));
      s.prod.calls = [];
      return s;
    }
    const OK = { FILES_BACKUP_ACTION: 'restore', FILES_BACKUP_PREFIX: 'tenants/t1/', FILES_BACKUP_CONFIRM_BUCKET: PROD };

    it.each([
      ['sem prefixo', { FILES_BACKUP_PREFIX: '' }, /exige FILES_BACKUP_PREFIX/],
      ['sem confirmação', { FILES_BACKUP_CONFIRM_BUCKET: '' }, /FILES_BACKUP_CONFIRM_BUCKET/],
      ['confirmação com o bucket errado', { FILES_BACKUP_CONFIRM_BUCKET: BKP }, /FILES_BACKUP_CONFIRM_BUCKET/],
    ])('recusa %s, sem nenhuma chamada', async (_l, extra, msg) => {
      const s = await prepared();
      const r = await run(s, { ...OK, ...(extra as Record<string, string>) });
      expect(r.error).toMatch(msg);
      expect(s.prod.calls).toEqual([]);
    });

    it('copia só o que falta, nunca sobrescreve, não cria _superseded e não escreve no backup', async () => {
      const s = await prepared();
      const dry = await run(s, { ...OK, FILES_BACKUP_DRY_RUN: '1' });
      expect(dry).toMatchObject({ ok: true, wouldCopy: 1, divergentNotOverwritten: 1, copied: 0 });
      expect(s.prod.writes()).toEqual([]);
      const r = await run(s, OK);
      expect(r).toMatchObject({ ok: true, copied: 1, divergentNotOverwritten: 1, scanned: 2 });
      expect(r.superseded).toBeUndefined();
      expect(r.notOverwritten).toEqual([
        { key: 'tenants/t1/epi-fichas/e1/v1.pdf', motivo: 'tamanho diverge da origem — não sobrescrito' },
      ]);
      expect(s.prod.bucket(PROD).get('tenants/t1/documents/a.pdf')!.body.toString()).toBe('documento A');
      expect(s.prod.bucket(PROD).get('tenants/t1/epi-fichas/e1/v1.pdf')!.body.toString()).toBe('versão nova na produção');
      expect(s.prod.writes()).toEqual([`PutObject:${PROD}:tenants/t1/documents/a.pdf`]);
      expect([...s.prod.bucket(PROD).keys()].some((k) => k.startsWith('_superseded/'))).toBe(false);
      expect(s.bkp.writes().filter((c) => !c.endsWith(SENTINEL))).toHaveLength(5); // só as do sync inicial
    });

    it('objeto criado na produção entre a listagem e o Put NÃO é sobrescrito (If-None-Match) e não conta como falha', async () => {
      const s = await prepared();
      s.bkp.onGet = (i) => {
        if (i.Key === 'tenants/t1/documents/a.pdf') s.prod.put(PROD, i.Key, Buffer.from('criado agora pela aplicação'));
      };
      const r = await run(s, { ...OK, FILES_BACKUP_RETRIES: '3' });
      expect(r).toMatchObject({ ok: true, copied: 0, failed: 0, createdMeanwhileNotOverwritten: 1 });
      expect(r.notOverwritten.map((n: any) => n.key)).toContain('tenants/t1/documents/a.pdf');
      expect(s.prod.bucket(PROD).get('tenants/t1/documents/a.pdf')!.body.toString()).toBe('criado agora pela aplicação');
      expect(s.prod.ifNoneMatchSeen).toEqual(['Put:tenants/t1/documents/a.pdf:*']); // uma tentativa só
    });

    it('corrida também no multipart: Complete com If-None-Match recusa e o upload é abortado', async () => {
      const s = setup();
      const big = Buffer.alloc(6 * 1024 * 1024, 7);
      s.prod.put(PROD, 'normative/grande/x.pdf', big);
      await run(s, { FILES_BACKUP_MULTIPART_MB: '5', FILES_BACKUP_PART_SIZE_MB: '5' });
      s.prod.readOnly = false;
      s.bkp.readOnly = true;
      s.prod.bucket(PROD).delete('normative/grande/x.pdf');
      s.bkp.onGet = (i) => {
        if (i.Key === 'normative/grande/x.pdf' && i.IfMatch) s.prod.put(PROD, i.Key, Buffer.from('novo'));
      };
      const r = await run(s, {
        FILES_BACKUP_ACTION: 'restore',
        FILES_BACKUP_PREFIX: 'normative/grande/',
        FILES_BACKUP_CONFIRM_BUCKET: PROD,
        FILES_BACKUP_MULTIPART_MB: '5',
        FILES_BACKUP_PART_SIZE_MB: '5',
      });
      expect(r).toMatchObject({ ok: true, failed: 0, createdMeanwhileNotOverwritten: 1 });
      expect(s.prod.bucket(PROD).get('normative/grande/x.pdf')!.body.toString()).toBe('novo');
      expect(s.prod.uploads.size).toBe(0);
      expect(s.prod.calls.some((c) => c.startsWith('AbortMultipartUpload'))).toBe(true);
    });

    it('sentido normal NÃO usa If-None-Match (precisa poder regravar divergente no backup)', async () => {
      const s = setup();
      await run(s);
      expect(s.bkp.ifNoneMatchSeen.every((x) => x.endsWith(':-'))).toBe(true);
    });

    it.each([
      ['tenants/', true],
      ['tenants/t1', true],
      ['RAG MONTESESST/', true],
      ['tenants/t1/', false],
      ['tenants/t1/documents/', false],
      ['normative/', false],
      ['esocial-certificates/', false],
      ['RAG MONTESESST/Arquivos pdf/', false],
    ])('prefixo de restore %s é amplo? %s', async (prefix, amplo) => {
      const s = await prepared();
      const r = await run(s, { ...OK, FILES_BACKUP_PREFIX: prefix, FILES_BACKUP_DRY_RUN: '1' });
      if (amplo) {
        expect(r.error).toMatch(/prefixo amplo recusado/);
        const ok = await run(s, { ...OK, FILES_BACKUP_PREFIX: prefix, FILES_BACKUP_DRY_RUN: '1', FILES_BACKUP_ALLOW_BROAD_RESTORE: '1' });
        expect(ok.ok).toBe(true);
        expect(ok.aviso).toMatch(/LGPD/);
      } else {
        expect(r.ok).toBe(true);
        expect(r.aviso).toBeUndefined();
      }
    });

    it.each(['/', '..', 'RAG', 'tenants/../normative/', 'tenants//x/', 'tenants/./x/', 'backups/postgres/'])(
      'prefixo inválido %s é recusado sem nenhuma chamada (mesmo com ALLOW_BROAD)',
      async (prefix) => {
        const s = await prepared();
        const r = await run(s, { ...OK, FILES_BACKUP_PREFIX: prefix, FILES_BACKUP_ALLOW_BROAD_RESTORE: '1' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/FILES_BACKUP_PREFIX/);
        expect(s.prod.calls).toEqual([]);
      },
    );

    it('recusa se o bucket lido como backup não tem o sentinela', async () => {
      const s = await prepared();
      s.bkp.bucket(BKP).delete(SENTINEL);
      const r = await run(s, OK);
      expect(r.error).toMatch(/sem o sentinela/);
      expect(s.prod.writes()).toEqual([]);
    });
  });

  it('list-superseded só lista (com corte por idade) e list-missing informa faltantes', async () => {
    const s = setup();
    await run(s);
    s.bkp.put(BKP, 'tenants/t1/documents/a.pdf', Buffer.from('velho!'));
    await run(s);
    const sup = [...s.bkp.bucket(BKP).entries()].find(([k]) => k.startsWith('_superseded/'))!;
    sup[1].lastModified = new Date(Date.now() - 40 * 86400000);
    const ls = await run(s, { FILES_BACKUP_ACTION: 'list-superseded', FILES_BACKUP_SUPERSEDED_MAX_AGE_DAYS: '30' });
    expect(ls).toMatchObject({ ok: true, count: 1, olderThanDays: 30, olderCount: 1 });
    expect(ls.items[0].key).toBe(sup[0]);
    s.bkp.bucket(BKP).delete('normative/nr-01/x/NR-01.pdf');
    const lm = await run(s, { FILES_BACKUP_ACTION: 'list-missing' });
    expect(lm).toMatchObject({ ok: true, missing: 1 });
    expect(lm.failures).toEqual([{ key: 'normative/nr-01/x/NR-01.pdf', motivo: 'faltando no destino' }]);
    expect(s.bkp.writes().some((c) => c.startsWith('Delete'))).toBe(false);
  });

  it('classifyKey, hostKey, supersededKey e FILES_BACKUP_PREFIX', () => {
    expect(backup.classifyKey('backups/postgres/x.dump')).toBe('excluded');
    expect(backup.classifyKey('tenants/')).toBe('marker');
    expect(backup.classifyKey('tenants/a\nb')).toBe('invalid');
    expect(backup.classifyKey('_superseded/x/tenants/a')).toBe('not-allowed');
    expect(backup.classifyKey(SENTINEL)).toBe('not-allowed');
    expect(backup.classifyKey('tenants/t/branding/logo.png')).toBe('ok');
    expect(backup.hostKey('http://B.Conta.R2.example.com.:9000/', 'b')).toBe('conta.r2.example.com:9000');
    expect(backup.supersededKey({ etag: 'abc-2' }, 'tenants/x')).toBe('_superseded/abc-2/tenants/x');
    expect(() => backup.readConfig(baseEnv({ FILES_BACKUP_PREFIX: 'backups/' }))).toThrow(/FILES_BACKUP_PREFIX/);
    expect(() => backup.readConfig(baseEnv({ FILES_BACKUP_CONCURRENCY: '99' }))).toThrow(/CONCURRENCY/);
    expect(backup.encodeCopySource('b', 'RAG MONTESESST/Ação.pdf')).toBe('b/RAG%20MONTESESST/A%C3%A7%C3%A3o.pdf');
  });
});
