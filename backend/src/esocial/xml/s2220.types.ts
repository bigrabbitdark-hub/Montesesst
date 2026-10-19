// Snapshot do que vai no S-2220. Guardado em esocial_events.payload_json: é a evidência do que foi
// montado, mesmo que o cadastro mude depois. Só entram os campos que o leiaute exige (minimização).
// Nunca entram resultado de exame (indResult) nem o conteúdo clínico do ASO.
export interface S2220Payload {
  ambiente: 'producao_restrita' | 'producao';
  empregador: { tpInsc: 1; nrInsc: string }; // nrInsc = CNPJ completo (14); o XML usa o CNPJ base
  trabalhador: { cpf: string; matricula?: string; codCateg?: string };
  tpExameOcup: 0 | 1 | 2 | 3 | 4 | 9;
  aso: {
    dtAso: string; // AAAA-MM-DD
    resAso: 1 | 2;
    exames: Array<{ dtExm: string; procRealizado: string; obsProc?: string; ordExame?: 1 | 2 }>;
    medico: { nmMed: string; nrCRM: string; ufCRM: string };
  };
  respMonit?: { cpfResp?: string; nmResp: string; nrCRM: string; ufCRM: string };
  indRetif: 1 | 2;
  nrRecibo?: string;
}

export const S2220_NAMESPACE = 'http://www.esocial.gov.br/schema/evt/evtMonit/v_S_01_03_00';
export const VER_PROC = 'montese-sst-1.0';

// aso_records.exam_type → {tpExameOcup} (XSD evtMonit v_S_01_03_00).
export const EXAM_TYPE_TO_TP_EXAME_OCUP: Record<string, 0 | 1 | 2 | 3 | 4 | 9> = {
  admissional: 0,
  periodico: 1,
  retorno_trabalho: 2,
  mudanca_funcao: 3,
  monitoracao_pontual: 4,
  demissional: 9,
};
