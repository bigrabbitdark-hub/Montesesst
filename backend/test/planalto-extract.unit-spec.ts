import { readFileSync } from 'fs';
import { join } from 'path';
import { extractHtmlText, PLANALTO_EXTRACT_OPTIONS } from '../src/normative/normative-monitor.service';
import { decodeHtmlBuffer } from '../src/normative/normative-text.util';
import { parseProvisions } from '../src/normative/provision-parser';

// TRECHOS REAIS do HTML do Planalto (bytes originais em ISO-8859-1, recortados por linha da página inteira; as
// páginas inteiras NÃO entram no repositório). Baixadas em 2026-10-09 com o User-Agent do monitor.
//   del5452.htm  https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm
//                sha256 da página inteira 5ec29acf5b53bb0de3ccc643ecbafc555cd4285d83e5510a879692d619a55851
//                del5452-arts191-193.html = linhas 9759–9886; del5452-art194.html = linhas 9941–9954
//   l8213cons.htm https://www.planalto.gov.br/ccivil_03/leis/l8213cons.htm
//                sha256 da página inteira 66ce4b43e9b82a670e7ef1fe10225ecd27a1f37f3a8e3251510352f0e16a72e9
//                l8213cons-art57.html = linhas 4512–4528
//   d3048.htm    https://www.planalto.gov.br/ccivil_03/decreto/d3048.htm
//                sha256 da página inteira 7c02b944ddd2cf2bd69fe05adf81c36b324b3f7326e3f3d244b0dbdc1609a63b
//                d3048-art66.html = linhas 8488–8493 + 8546–8567 (a tabela riscada entre elas foi omitida)
//                d3048-arts69-70.html = linhas 9180–9217 + 9261–9267 + 9308–9314 (tabelas riscadas omitidas)
const FIX = join(__dirname, 'fixtures', 'planalto');
const extrair = (arquivo: string) =>
  extractHtmlText(decodeHtmlBuffer(readFileSync(join(FIX, arquivo)), 'text/html'), PLANALTO_EXTRACT_OPTIONS);
const lei = (texto: string) => {
  const r = parseProvisions(texto, 'lei');
  // Invariante do parser: o literal é exatamente o trecho [char_start, char_end) do texto.
  for (const p of r.provisions) expect(texto.slice(p.char_start, p.char_end)).toBe(p.literal_text);
  return new Map(r.provisions.map((p) => [p.item_path, p.literal_text]));
};

describe('Planalto — trechos reais (texto riscado descartado + parser de leis)', () => {
  it('CLT arts. 191–193: "Art.\\n191 -", "Art. 192 -\\nO" e "Art .193 -" riscado viram a redação VIGENTE', () => {
    const t = extrair('del5452-arts191-193.html');
    // Redação revogada (riscada) não aparece.
    expect(t).not.toContain('As ferramentas manuais');
    expect(t).not.toContain('Os motores de gás');
    expect(t).not.toContain('contato permanente com inflamáveis ou explosivos');
    expect(t).not.toContain('Haverá nas máquinas dispositivos de partida');
    const d = lei(t);
    expect(d.get('art. 191')).toMatch(/^Art\. 191 - A eliminação ou a neutralização da insalubridade ocorrerá:/);
    expect(d.get('art. 191 inc. I')).toMatch(/^I - com a adoção de medidas/);
    expect(d.get('art. 191 inc. II')).toMatch(/^II - com a utilização de equipamentos de proteção individual/);
    expect(d.get('art. 191 §único')).toMatch(/^Parágrafo único - Caberá às Delegacias Regionais do Trabalho/);
    expect(d.get('art. 192')).toMatch(/^Art\. 192 - O exercício de trabalho em condições insalubres/);
    expect(d.get('art. 192')).toContain('(Redação dada pela Lei nº 6.514, de 22.12.1977)');
    expect(d.has('art. 192-O')).toBe(false);
    expect(d.get('art. 193')).toMatch(/^Art\. 193\. São consideradas atividades ou operações perigosas/);
    expect(d.get('art. 193')).toContain('Ministério do Trabalho e Emprego');
    expect(d.get('art. 193')).toContain('(Redação dada pela Lei nº 12.740, de 2012)');
    expect(d.get('art. 193 inc. I')).toMatch(/^I - inflamáveis, explosivos ou energia elétrica;/);
    expect(d.get('art. 193 inc. II')).toMatch(/^II - roubos ou outras espécies de violência física/);
    // "III \x96 colisões": a meia-risca é o byte 0x96 do windows-1252 (ver decodeHtmlBuffer); inciso próprio, não
    // continuação do inciso II.
    expect(d.get('art. 193 inc. III')).toMatch(/^III – colisões, atropelamentos/);
    expect(d.get('art. 193 inc. II')).not.toContain('colisões');
    expect(d.get('art. 193 §1')).toMatch(/^§ 1º - O trabalho em condições de periculosidade assegura/);
    expect(d.get('art. 193 §2')).toMatch(/^§ 2º - O empregado poderá optar/);
    expect([...d.keys()].filter((k) => /^art\. 193-/.test(k))).toEqual([]);
  });

  it('CLT art. 194: "Art.194 - O direito" é o art. 194 (não o sufixo 194-O), sem a redação riscada', () => {
    const t = extrair('del5452-art194.html');
    expect(t).not.toContain('Tôda caldeira');
    const d = lei(t);
    expect([...d.keys()]).toEqual(['art. 194']);
    expect(d.get('art. 194')).toMatch(/^Art\.194 - O direito do empregado ao adicional de insalubridade ou de periculosidade cessará/);
  });

  it('Lei 8.213 art. 57: a redação antiga riscada sai, a vigente fica com a nota de redação', () => {
    const t = extrair('l8213cons-art57.html');
    expect(t).not.toContain('cumprida a carência exigida nesta lei, ao\nsegurado');
    expect(t).not.toContain('conforme a atividade profissional');
    const d = lei(t);
    expect([...d.keys()]).toEqual(['art. 57']);
    expect(d.get('art. 57')).toBe(
      'Art. 57. A aposentadoria especial será devida, uma vez cumprida a carência exigida nesta Lei, ao segurado que tiver ' +
        'trabalhado sujeito a condições especiais que prejudiquem a saúde ou a integridade física, durante 15 (quinze), ' +
        '20 (vinte) ou 25 (vinte e cinco) anos, conforme dispuser a lei. (Redação dada pela Lei nº 9.032, de 1995)',
    );
  });

  it('Decreto 3.048 art. 66: <strike> e <span style="text-decoration:line-through"> saem; fica só a redação de 2020', () => {
    const t = extrair('d3048-art66.html');
    expect(t).not.toContain('sucessivamente');
    expect(t).not.toContain("devendo ser considerada a atividade preponderante");
    const d = lei(t);
    expect([...d.keys()]).toEqual(['art. 66']);
    expect(d.get('art. 66')).toMatch(/^Art\. 66\. Para o segurado que houver exercido duas ou mais atividades sujeitas a agentes químicos, físicos e biológicos/);
    expect(d.get('art. 66')).toContain('(Redação dada pelo Decreto nº 10.410, de 2020');
  });

  it('Decreto 3.048 art. 70 (revogado inteiro): sobra o endereço com a nota de revogação, sem redação riscada e sem dispositivo', () => {
    const t = extrair('d3048-arts69-70.html');
    expect(t).toContain('Parágrafo único. O segurado que retornar ao exercício de atividade');
    expect(t).not.toContain('Aplica-se o disposto no art. 48');
    expect(t).not.toContain('É vedada a conversão');
    expect(t).not.toContain('A conversão de tempo de atividade');
    expect(t).not.toContain('A caracterização e a comprovação');
    const linhas = t.split('\n');
    expect(linhas).toContain('Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).');
    expect(linhas.filter((l) => /^§ 1 ?[º°o] \(Revogado pelo Decreto nº 10\.410, de 2020\)\.$/.test(l))).toHaveLength(1);
    // Artigo/parágrafo só com a nota de revogação não vira dispositivo (e não engorda o dispositivo anterior).
    // A primeira linha é SINTÉTICA (o trecho começa no parágrafo único do art. 69).
    const d = lei('Art. 69. A data de início será fixada.\n' + t);
    expect(d.has('art. 70')).toBe(false);
    expect(d.has('art. 70 §1')).toBe(false);
    expect(d.get('art. 69 §único')).toMatch(/^Parágrafo único\. O segurado que retornar/);
    expect(d.get('art. 69 §único')).not.toContain('Revogado');
  });
});
