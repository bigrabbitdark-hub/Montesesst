import { Injectable } from '@nestjs/common';
import * as https from 'https';
import {
  ConsultaResult, EnvioResult, MAX_SOAP_BYTES, SOAP_ACTION_CONSULTA, SOAP_ACTION_ENVIO,
  buildConsultaSoap, buildConsultaXml, buildEnvioSoap, parseConsultaResponse, parseEnvioResponse,
} from './lote.util';

export interface ClientCertificate { pfx: Buffer; passphrase: string }
export interface SoapCallOptions {
  timeoutMs?: number;
  // Só para testes (servidor local com CA própria). Em produção a cadeia vem do repositório de CAs do Node.
  ca?: string | Buffer;
  allowedHostSuffixes?: string[];
}

const DEFAULT_HOST_SUFFIXES = ['.esocial.gov.br'];
// Cifras aceitas pelos servidores do eSocial desde 24/06/2024 (Manual do Desenvolvedor v1.16, 6.5), TLS 1.2.
const CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-GCM-SHA384';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// SOAP 1.1 document/literal sobre HTTPS com autenticação mútua (certificado do cliente).
// DIFERENTE do TST (que desliga a verificação de hostname): aqui o hostname e a cadeia do servidor
// são SEMPRE verificados (rejectUnauthorized padrão + checkServerIdentity padrão), o endereço tem de
// ser https:// e terminar em .esocial.gov.br, e não há redirecionamento.
@Injectable()
export class EsocialSoapClient {
  async enviarLote(endpoint: string, loteXml: string, cert: ClientCertificate, opts: SoapCallOptions = {}): Promise<EnvioResult> {
    const raw = await this.post(endpoint, buildEnvioSoap(loteXml), SOAP_ACTION_ENVIO, cert, opts);
    return parseEnvioResponse(raw);
  }

  async consultarLote(endpoint: string, protocoloEnvio: string, cert: ClientCertificate, opts: SoapCallOptions = {}): Promise<ConsultaResult> {
    const raw = await this.post(endpoint, buildConsultaSoap(buildConsultaXml(protocoloEnvio)), SOAP_ACTION_CONSULTA, cert, opts);
    return parseConsultaResponse(raw);
  }

  private post(endpoint: string, body: string, action: string, cert: ClientCertificate, opts: SoapCallOptions): Promise<string> {
    const url = new URL(endpoint);
    const suffixes = opts.allowedHostSuffixes ?? DEFAULT_HOST_SUFFIXES;
    if (url.protocol !== 'https:' || !suffixes.some((s) => url.hostname === s.replace(/^\./, '') || url.hostname.endsWith(s))) {
      return Promise.reject(new Error('Endereço do eSocial não permitido (exige https e domínio esocial.gov.br)'));
    }
    if (Buffer.byteLength(body, 'utf8') > MAX_SOAP_BYTES) return Promise.reject(new Error('Mensagem SOAP acima de 750 KB'));

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: 'POST', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
          pfx: cert.pfx, passphrase: cert.passphrase, ca: opts.ca,
          minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', ciphers: CIPHERS, rejectUnauthorized: true,
          timeout: opts.timeoutMs ?? 60_000,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body, 'utf8'),
            SOAPAction: `"${action}"`,
          },
        },
        (res) => {
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) { req.destroy(new Error('Resposta do eSocial grande demais')); return; }
            chunks.push(c);
          });
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            // SOAP Fault volta com HTTP 500; o parser do chamador extrai a mensagem.
            if (res.statusCode && res.statusCode >= 300 && !/Fault/.test(text)) {
              reject(new Error(`eSocial respondeu HTTP ${res.statusCode}`));
            } else resolve(text);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao falar com o eSocial')));
      req.on('error', reject);
      req.end(body);
    });
  }
}
