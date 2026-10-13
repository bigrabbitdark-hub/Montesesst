import { escapeXml as x } from './xml-escape';
import { VER_PROC } from './s2220.types';
import { cnpjBase } from './s2220-xml.builder';

export const S3000_NAMESPACE = 'http://www.esocial.gov.br/schema/evt/evtExclusao/v_S_01_03_00';

// Snapshot do S-3000. Para eventos não periódicos (S-2220 entre eles) o leiaute exige o CPF do
// trabalhador do evento excluído (MOS S-1.3, S-3000, item 1.3.a); não há período de apuração.
export interface S3000Payload {
  ambiente: 'producao_restrita' | 'producao';
  empregador: { tpInsc: 1; nrInsc: string };
  tpEvento: string; // ex.: "S-2220" (6 posições)
  nrRecEvt: string; // recibo do evento a excluir; se já foi retificado, o do ÚLTIMO retificador
  cpfTrab: string;
}

export function buildS3000Xml(p: S3000Payload, eventId: string): string {
  return (
    `<eSocial xmlns="${S3000_NAMESPACE}"><evtExclusao Id="${x(eventId)}">` +
    `<ideEvento><tpAmb>${p.ambiente === 'producao' ? 1 : 2}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>` +
    `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${x(cnpjBase(p.empregador.nrInsc))}</nrInsc></ideEmpregador>` +
    `<infoExclusao><tpEvento>${x(p.tpEvento)}</tpEvento><nrRecEvt>${x(p.nrRecEvt)}</nrRecEvt>` +
    `<ideTrabalhador><cpfTrab>${x(p.cpfTrab)}</cpfTrab></ideTrabalhador></infoExclusao>` +
    `</evtExclusao></eSocial>`
  );
}
