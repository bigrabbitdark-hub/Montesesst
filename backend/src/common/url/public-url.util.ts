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
  if (/^fe[89a-f]/.test(v6)) return false; // fe80::/10 e fec0::/10 (site-local)
  if (/^::\d+\.\d+\.\d+\.\d+$/.test(v6)) return false; // IPv4-compatível
  if (/^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(v6)) return false; // IPv4-compatível em hex
  if (v6.startsWith('::ffff:0:')) return false; // IPv4-translated
  if (v6.startsWith('2002:')) return false; // 6to4
  if (/^100::/.test(v6) || /^100(:0{1,4}){3}:/.test(v6)) return false; // 100::/64 (descarte)
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

function verificarPorta(url: URL): void {
  if (!PORTAS_PERMITIDAS.has(url.port)) {
    throw new UnsafeUrlError('A URL só pode usar as portas 80 e 443');
  }
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

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError('A URL aponta para um endereço não público');
    verificarPorta(url);
    return url;
  }
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('A URL aponta para um nome de host interno');
  }
  verificarPorta(url);

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
      await response.body?.cancel().catch(() => {});
      try {
        atual = new URL(destino, url).toString();
      } catch {
        throw new UnsafeUrlError('Redirecionamento inválido');
      }
      continue;
    }
    return { response, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError('Redirecionamentos demais');
}

export async function readBodyCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const mensagem = `Fonte maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`;
  const declarado = Number(response.headers.get('content-length') ?? 0);
  if (declarado > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(mensagem);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const partes: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(mensagem);
      partes.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  return Buffer.concat(partes);
}
