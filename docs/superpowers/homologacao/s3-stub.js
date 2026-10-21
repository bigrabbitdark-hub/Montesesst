// Stub S3/R2 mínimo para HOMOLOGAÇÃO (memória, sem autenticação, sem persistência).
// Aceita PutObject/GetObject/DeleteObject/HeadObject em path-style (/<bucket>/<chave>), inclusive
// corpo "aws-chunked" do SDK v3. NUNCA usar fora do ambiente descartável.
const http = require('http');
const crypto = require('crypto');
const store = new Map();

function decodeAwsChunked(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const lineEnd = buf.indexOf('\r\n', i);
    if (lineEnd < 0) break;
    const size = parseInt(buf.slice(i, lineEnd).toString().split(';')[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size));
    i = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(out);
}

http.createServer((req, res) => {
  const key = decodeURIComponent((req.url || '/').split('?')[0]);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    if (req.method === 'PUT') {
      if (/aws-chunked/i.test(String(req.headers['content-encoding'] || '')) || req.headers['x-amz-content-sha256'] === 'STREAMING-UNSIGNED-PAYLOAD-TRAILER') body = decodeAwsChunked(body);
      store.set(key, { body, type: String(req.headers['content-type'] || 'application/octet-stream') });
      res.writeHead(200, { ETag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      return res.end();
    }
    const obj = store.get(key);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!obj) { res.writeHead(404, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200, { 'Content-Type': obj.type, 'Content-Length': obj.body.length, ETag: `"${crypto.createHash('md5').update(obj.body).digest('hex')}"` });
      return res.end(req.method === 'GET' ? obj.body : undefined);
    }
    if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
}).listen(9000, '0.0.0.0', () => console.log('s3-stub em :9000'));
