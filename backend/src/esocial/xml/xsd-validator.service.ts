import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

export interface XsdValidationResult {
  valid: boolean;
  errors: string[];
}

export type Schema = 'evtMonit' | 'evtCAT' | 'evtExclusao' | 'envioLote' | 'consultaLote';

const SCHEMA_DIR = join(__dirname, '..', 'schemas');

// Valida XML contra os XSD OFICIAIS do eSocial (pacote S-1.3 até NT 07/2026 rev., "produção em
// 23/11/2026", e Pacote de Comunicação v1.6), copiados sem alteração para src/esocial/schemas.
// libxml2 em WebAssembly: nada de binário nativo na imagem Alpine, e roda em worker thread.
@Injectable()
export class XsdValidatorService {
  private cache = new Map<string, { fileName: string; contents: string }>();

  private file(rel: string) {
    let f = this.cache.get(rel);
    if (!f) {
      f = { fileName: rel.split('/').pop()!, contents: readFileSync(join(SCHEMA_DIR, rel), 'utf8') };
      this.cache.set(rel, f);
    }
    return f;
  }

  async validate(schema: Schema, xml: string): Promise<XsdValidationResult> {
    const isEvt = schema === 'evtMonit' || schema === 'evtCAT' || schema === 'evtExclusao';
    const main = isEvt
      ? this.file(`evt/${schema}.xsd`)
      : schema === 'envioLote'
        ? this.file('lote/EnvioLoteEventos-v1_1_1.xsd')
        : this.file('lote/ConsultaLoteEventos-v1_0_0.xsd');
    const preload = isEvt ? [this.file('evt/tipos.xsd'), this.file('evt/xmldsig-core-schema.xsd')] : [];
    const result = await validateXML({
      xml: [{ fileName: 'evento.xml', contents: xml }],
      schema: [main],
      preload,
      initialMemoryPages: 256,
      maxMemoryPages: 2048,
    });
    return { valid: result.valid, errors: result.errors.map((e: any) => e.message ?? String(e)) };
  }
}
