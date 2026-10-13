import { escapeXml as x } from './xml-escape';
import { VER_PROC } from './s2220.types';

export const S2210_NAMESPACE = 'http://www.esocial.gov.br/schema/evt/evtCAT/v_S_01_03_00';

const sn = (b: boolean) => (b ? 'S' : 'N');

// Snapshot do S-2210 (esocial_events.payload_json). Dado de saúde: fica só no banco do tenant (RLS)
// e vai ao eSocial no XML assinado; nunca a IA.
export interface S2210Payload {
  ambiente: 'producao_restrita' | 'producao';
  empregador: { tpInsc: 1; nrInsc: string };
  trabalhador: { cpf: string; matricula?: string; codCateg?: string };
  indRetif: 1 | 2;
  cat: {
    dtAcid: string;
    tpAcid: 1 | 2 | 3;
    hrAcid?: string;
    hrsTrabAntesAcid?: string;
    tpCat: 1 | 2 | 3;
    indCatObito: boolean;
    dtObito?: string;
    indComunPolicia: boolean;
    codSitGeradora: string;
    iniciatCAT: 1 | 2 | 3;
    obsCAT?: string;
    ultDiaTrab?: string;
    houveAfast?: boolean;
    localAcidente: {
      tpLocal: 1 | 2 | 3 | 4 | 5 | 6 | 9;
      dscLocal?: string; tpLograd?: string; dscLograd: string; nrLograd: string; complemento?: string;
      bairro?: string; cep?: string; codMunic?: string; uf?: string; pais?: string; codPostal?: string;
      ideLocalAcid?: { tpInsc: 1 | 3 | 4; nrInsc: string };
    };
    parteAtingida: { codParteAting: string; lateralidade: 0 | 1 | 2 | 3 };
    agenteCausador: { codAgntCausador: string };
    atestado: {
      dtAtendimento: string; hrAtendimento: string; indInternacao: boolean; durTrat: number; indAfast: boolean;
      dscLesao: string; dscCompLesao?: string; diagProvavel?: string; codCID: string; observacao?: string;
      emitente: { nmEmit: string; ideOC: 1 | 2 | 3; nrOC: string; ufOC?: string };
    };
    catOrigem?: { nrRecCatOrig: string };
  };
}

const opt = (tag: string, v: string | undefined) => (v ? `<${tag}>${x(v)}</${tag}>` : '');

export function buildS2210Xml(p: S2210Payload, eventId: string, cnpjBaseFn: (c: string) => string): string {
  const c = p.cat; const l = c.localAcidente; const a = c.atestado; const t = p.trabalhador;
  return (
    `<eSocial xmlns="${S2210_NAMESPACE}"><evtCAT Id="${x(eventId)}">` +
    `<ideEvento><indRetif>${p.indRetif}</indRetif><tpAmb>${p.ambiente === 'producao' ? 1 : 2}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>` +
    `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${x(cnpjBaseFn(p.empregador.nrInsc))}</nrInsc></ideEmpregador>` +
    `<ideVinculo><cpfTrab>${x(t.cpf)}</cpfTrab>${opt('matricula', t.matricula)}${opt('codCateg', t.codCateg)}</ideVinculo>` +
    `<cat><dtAcid>${x(c.dtAcid)}</dtAcid><tpAcid>${c.tpAcid}</tpAcid>${opt('hrAcid', c.hrAcid)}${opt('hrsTrabAntesAcid', c.hrsTrabAntesAcid)}` +
    `<tpCat>${c.tpCat}</tpCat><indCatObito>${sn(c.indCatObito)}</indCatObito>${opt('dtObito', c.dtObito)}` +
    `<indComunPolicia>${sn(c.indComunPolicia)}</indComunPolicia><codSitGeradora>${x(c.codSitGeradora)}</codSitGeradora>` +
    `<iniciatCAT>${c.iniciatCAT}</iniciatCAT>${opt('obsCAT', c.obsCAT)}${opt('ultDiaTrab', c.ultDiaTrab)}` +
    (c.houveAfast === undefined ? '' : `<houveAfast>${sn(c.houveAfast)}</houveAfast>`) +
    `<localAcidente><tpLocal>${l.tpLocal}</tpLocal>${opt('dscLocal', l.dscLocal)}${opt('tpLograd', l.tpLograd)}` +
    `<dscLograd>${x(l.dscLograd)}</dscLograd><nrLograd>${x(l.nrLograd)}</nrLograd>${opt('complemento', l.complemento)}${opt('bairro', l.bairro)}` +
    `${opt('cep', l.cep)}${opt('codMunic', l.codMunic)}${opt('uf', l.uf)}${opt('pais', l.pais)}${opt('codPostal', l.codPostal)}` +
    (l.ideLocalAcid ? `<ideLocalAcid><tpInsc>${l.ideLocalAcid.tpInsc}</tpInsc><nrInsc>${x(l.ideLocalAcid.nrInsc)}</nrInsc></ideLocalAcid>` : '') +
    `</localAcidente>` +
    `<parteAtingida><codParteAting>${x(c.parteAtingida.codParteAting)}</codParteAting><lateralidade>${c.parteAtingida.lateralidade}</lateralidade></parteAtingida>` +
    `<agenteCausador><codAgntCausador>${x(c.agenteCausador.codAgntCausador)}</codAgntCausador></agenteCausador>` +
    `<atestado><dtAtendimento>${x(a.dtAtendimento)}</dtAtendimento><hrAtendimento>${x(a.hrAtendimento)}</hrAtendimento>` +
    `<indInternacao>${sn(a.indInternacao)}</indInternacao><durTrat>${a.durTrat}</durTrat><indAfast>${sn(a.indAfast)}</indAfast>` +
    `<dscLesao>${x(a.dscLesao)}</dscLesao>${opt('dscCompLesao', a.dscCompLesao)}${opt('diagProvavel', a.diagProvavel)}<codCID>${x(a.codCID)}</codCID>${opt('observacao', a.observacao)}` +
    `<emitente><nmEmit>${x(a.emitente.nmEmit)}</nmEmit><ideOC>${a.emitente.ideOC}</ideOC><nrOC>${x(a.emitente.nrOC)}</nrOC>${opt('ufOC', a.emitente.ufOC)}</emitente></atestado>` +
    (c.catOrigem ? `<catOrigem><nrRecCatOrig>${x(c.catOrigem.nrRecCatOrig)}</nrRecCatOrig></catOrigem>` : '') +
    `</cat></evtCAT></eSocial>`
  );
}
