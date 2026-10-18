// Proxy de pré-visualização (sem dependências). Escuta só em 127.0.0.1.
//   /api/*  -> backend (sem o prefixo /api, como o nginx faz)
//   resto   -> next dev da cópia isolada
const http = require('http');
const net = require('net');

const PORT = +process.env.PREVIEW_PORT || 3100;
const BACK = { host: process.env.BACK_HOST, port: +process.env.BACK_PORT || 3001 };
const FRONT = { host: '127.0.0.1', port: +process.env.FRONT_PORT || 3101 };
if (!BACK.host) { console.error('BACK_HOST obrigatório'); process.exit(1); }

function route(url) {
  if (url === '/api' || url.startsWith('/api/')) return { t: BACK, path: url.replace(/^\/api/, '') || '/' };
  return { t: FRONT, path: url };
}

http.createServer((req, res) => {
  const r = route(req.url);
  const headers = { ...req.headers, host: `${r.t.host}:${r.t.port}` };
  // O backend só confere o cabeçalho Origin (CORS) e aceita pedidos sem ele (como curl/servidor).
  // A sessão é um Bearer token, não cookie. Para o backend, o proxy age como cliente de servidor.
  if (r.t === BACK) { delete headers.origin; }
  const p = http.request(
    { host: r.t.host, port: r.t.port, path: r.path, method: req.method, headers },
    (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); },
  );
  p.on('error', (e) => { res.statusCode = 502; res.end('proxy error: ' + e.message); });
  req.pipe(p);
}).on('upgrade', (req, sock, head) => {
  const r = route(req.url);
  const s = net.connect(r.t.port, r.t.host, () => {
    const hs = { ...req.headers, host: `${r.t.host}:${r.t.port}` };
    s.write(`${req.method} ${r.path} HTTP/1.1\r\n` + Object.entries(hs).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    s.write(head); sock.pipe(s); s.pipe(sock);
  });
  s.on('error', () => sock.destroy());
  sock.on('error', () => s.destroy());
}).listen(PORT, '127.0.0.1', () => console.log(`preview em http://127.0.0.1:${PORT}  (api -> ${BACK.host}:${BACK.port}, front -> ${FRONT.port})`));
