import { DOMParser } from '@xmldom/xmldom';
import { escapeXml } from '../xml/xml-escape';

// Namespaces e ações SOAP do Pacote de Comunicação eSocial v1.6 (WSDL v1_1_0, VERIFICADO).
export const NS_LOTE_ENVIO = 'http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1';
export const NS_CONSULTA = 'http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0';
const NS_SVC_ENVIO = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0';
const NS_SVC_CONSULTA = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0';
export const SOAP_ACTION_ENVIO = `${NS_SVC_ENVIO}/ServicoEnviarLoteEventos/EnviarLoteEventos`;
export const SOAP_ACTION_CONSULTA = `${NS_SVC_CONSULTA}/ServicoConsultarLoteEventos/ConsultarLoteEventos`;

// Limites do Manual do Desenvolvedor v1.16: até 50 eventos por lote; mensagem SOAP até 750 KB.
export const MAX_EVENTOS_POR_LOTE = 50;
export const MAX_SOAP_BYTES = 750 * 1024;

export const GRUPO_NAO_PERIODICOS = 2; // 1 tabelas, 2 não periódicos, 3 periódicos

export interface LoteEvento {
  id: string;
  signedXml: string;
}

export function buildLoteXml(params: {
  empregadorCnpjBase: string; // 8 dígitos
  transmissor: { tpInsc: 1 | 2; nrInsc: string }; // do certificado da conexão TLS
  grupo: number;
  eventos: LoteEvento[];
}): string {
  if (params.eventos.length < 1 || params.eventos.length > MAX_EVENTOS_POR_LOTE) {
    throw new Error(`Lote deve ter de 1 a ${MAX_EVENTOS_POR_LOTE} eventos`);
  }
  const eventos = params.eventos
    .map((e) => `<evento Id="${escapeXml(e.id)}">${e.signedXml.replace(/^<\?xml[^>]*\?>\s*/, '')}</evento>`)
    .join('');
  return (
    `<eSocial xmlns="${NS_LOTE_ENVIO}"><envioLoteEventos grupo="${params.grupo}">` +
    `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${escapeXml(params.empregadorCnpjBase)}</nrInsc></ideEmpregador>` +
    `<ideTransmissor><tpInsc>${params.transmissor.tpInsc}</tpInsc><nrInsc>${escapeXml(params.transmissor.nrInsc)}</nrInsc></ideTransmissor>` +
    `<eventos>${eventos}</eventos></envioLoteEventos></eSocial>`
  );
}

export function buildConsultaXml(protocoloEnvio: string): string {
  return `<eSocial xmlns="${NS_CONSULTA}"><consultaLoteEventos><protocoloEnvio>${escapeXml(protocoloEnvio)}</protocoloEnvio></consultaLoteEventos></eSocial>`;
}

const soap = (inner: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

export function buildEnvioSoap(loteXml: string): string {
  const body = soap(`<v1:EnviarLoteEventos xmlns:v1="${NS_SVC_ENVIO}"><v1:loteEventos>${loteXml}</v1:loteEventos></v1:EnviarLoteEventos>`);
  if (Buffer.byteLength(body, 'utf8') > MAX_SOAP_BYTES) throw new Error('Mensagem SOAP acima de 750 KB (limite do eSocial)');
  return body;
}

export function buildConsultaSoap(consultaXml: string): string {
  return soap(`<v1:ConsultarLoteEventos xmlns:v1="${NS_SVC_CONSULTA}"><v1:consulta>${consultaXml}</v1:consulta></v1:ConsultarLoteEventos>`);
}

// ---------- parsers (por nome local: o eSocial muda o namespace a cada versão) ----------

export interface Ocorrencia { codigo: string; descricao: string; tipo?: string; localizacao?: string }
export interface EnvioResult { cdResposta: number; descResposta: string; protocoloEnvio?: string; ocorrencias: Ocorrencia[] }
export interface EventoRetorno { id: string; cdResposta?: number; descResposta?: string; nrRecibo?: string; ocorrencias: Ocorrencia[] }
export interface ConsultaResult { cdResposta: number; descResposta: string; eventos: EventoRetorno[]; ocorrencias: Ocorrencia[] }

function parse(xml: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_l: string, m: string) => errors.push(m) } as any).parseFromString(xml, 'text/xml');
  if (!doc || !doc.documentElement || errors.some((e) => /fatal|error/i.test(e))) throw new Error('Resposta do eSocial não é um XML válido');
  return doc as unknown as Document;
}

const kids = (n: Element, name: string): Element[] =>
  Array.from(n.childNodes as any).filter((c: any) => c.nodeType === 1 && (c.localName || c.nodeName) === name) as Element[];
const first = (n: Element | undefined, name: string): Element | undefined => (n ? kids(n, name)[0] : undefined);
const txt = (n: Element | undefined, name: string): string | undefined => first(n, name)?.textContent?.trim() || undefined;
function find(n: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    for (const c of Array.from(e.childNodes as any) as any[]) {
      if (c.nodeType !== 1) continue;
      if ((c.localName || c.nodeName) === name) out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}
function ocorrencias(scope: Element | undefined): Ocorrencia[] {
  if (!scope) return [];
  return find(scope, 'ocorrencia').map((o) => ({
    codigo: txt(o, 'codigo') ?? '', descricao: txt(o, 'descricao') ?? '', tipo: txt(o, 'tipo'), localizacao: txt(o, 'localizacao'),
  }));
}
function fault(doc: Document) {
  const f = find(doc.documentElement as any, 'Fault')[0];
  if (f) throw new Error(`SOAP Fault do eSocial: ${(txt(f, 'faultstring') ?? 'sem detalhe').slice(0, 300)}`);
}

export function parseEnvioResponse(soapXml: string): EnvioResult {
  const doc = parse(soapXml); fault(doc);
  const root = find(doc.documentElement as any, 'retornoEnvioLoteEventos')[0];
  if (!root) throw new Error('Resposta de envio sem retornoEnvioLoteEventos');
  const status = first(root, 'status');
  return {
    cdResposta: Number(txt(status, 'cdResposta')), descResposta: txt(status, 'descResposta') ?? '',
    protocoloEnvio: txt(first(root, 'dadosRecepcaoLote'), 'protocoloEnvio'), ocorrencias: ocorrencias(status),
  };
}

export function parseConsultaResponse(soapXml: string): ConsultaResult {
  const doc = parse(soapXml); fault(doc);
  const root = find(doc.documentElement as any, 'retornoProcessamentoLoteEventos')[0];
  if (!root) throw new Error('Resposta de consulta sem retornoProcessamentoLoteEventos');
  const status = first(root, 'status');
  const eventos = find(root, 'evento').map((ev): EventoRetorno => {
    const re = find(ev, 'retornoEvento')[0];
    const proc = re ? find(re, 'processamento')[0] : undefined;
    return {
      id: ev.getAttribute('Id') ?? '',
      cdResposta: proc ? Number(txt(proc, 'cdResposta')) : undefined,
      descResposta: txt(proc, 'descResposta'),
      nrRecibo: re ? txt(find(re, 'recibo')[0], 'nrRecibo') : undefined,
      ocorrencias: ocorrencias(proc),
    };
  });
  return { cdResposta: Number(txt(status, 'cdResposta')), descResposta: txt(status, 'descResposta') ?? '', eventos, ocorrencias: ocorrencias(status) };
}
