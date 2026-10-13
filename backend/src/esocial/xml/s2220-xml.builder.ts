import { escapeXml as x } from './xml-escape';
import { S2220Payload, S2220_NAMESPACE, VER_PROC } from './s2220.types';

// Id do evento (TS_Id, 36 posições): "ID" + tpInsc(1) + inscrição em 14 posições (CNPJ base de 8
// completado com zeros à direita) + AAAAMMDDhhmmss + sequencial de 5 dígitos. Manual do
// Desenvolvedor v1.16, seção 8.3.
export function buildEventId(nrInscBase: string, now: Date, sequence: number): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  const ts =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `ID1${nrInscBase.padEnd(14, '0')}${ts}${p(sequence % 100000, 5)}`;
}

// CNPJ-raiz de 8 posições para ideEmpregador (MOS S-1.3: exceto administração pública federal,
// que não é o caso de clientes do Montese).
export function cnpjBase(cnpj: string): string {
  return cnpj.toUpperCase().slice(0, 8);
}

// Monta o XML do evento S-2220 sem assinatura. A ordem dos elementos segue evtMonit.xsd (oficial,
// pacote "produção em 23/11/2026"); a conformidade é provada em teste validando contra o XSD.
export function buildS2220Xml(payload: S2220Payload, eventId: string): string {
  const t = payload.trabalhador;
  const exames = payload.aso.exames
    .map(
      (e) =>
        `<exame><dtExm>${x(e.dtExm)}</dtExm><procRealizado>${x(e.procRealizado)}</procRealizado>` +
        (e.obsProc ? `<obsProc>${x(e.obsProc)}</obsProc>` : '') +
        (e.ordExame ? `<ordExame>${e.ordExame}</ordExame>` : '') +
        `</exame>`,
    )
    .join('');
  const m = payload.aso.medico;
  const r = payload.respMonit;
  return (
    `<eSocial xmlns="${S2220_NAMESPACE}">` +
    `<evtMonit Id="${x(eventId)}">` +
    `<ideEvento><indRetif>${payload.indRetif}</indRetif>` +
    (payload.nrRecibo ? `<nrRecibo>${x(payload.nrRecibo)}</nrRecibo>` : '') +
    `<tpAmb>${payload.ambiente === 'producao' ? 1 : 2}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>` +
    `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${x(cnpjBase(payload.empregador.nrInsc))}</nrInsc></ideEmpregador>` +
    `<ideVinculo><cpfTrab>${x(t.cpf)}</cpfTrab>` +
    (t.matricula ? `<matricula>${x(t.matricula)}</matricula>` : '') +
    (t.codCateg ? `<codCateg>${x(t.codCateg)}</codCateg>` : '') +
    `</ideVinculo>` +
    `<exMedOcup><tpExameOcup>${payload.tpExameOcup}</tpExameOcup>` +
    `<aso><dtAso>${x(payload.aso.dtAso)}</dtAso><resAso>${payload.aso.resAso}</resAso>${exames}` +
    `<medico><nmMed>${x(m.nmMed)}</nmMed><nrCRM>${x(m.nrCRM)}</nrCRM><ufCRM>${x(m.ufCRM)}</ufCRM></medico></aso>` +
    (r
      ? `<respMonit>` +
        (r.cpfResp ? `<cpfResp>${x(r.cpfResp)}</cpfResp>` : '') +
        `<nmResp>${x(r.nmResp)}</nmResp><nrCRM>${x(r.nrCRM)}</nrCRM><ufCRM>${x(r.ufCRM)}</ufCRM></respMonit>`
      : '') +
    `</exMedOcup></evtMonit></eSocial>`
  );
}
