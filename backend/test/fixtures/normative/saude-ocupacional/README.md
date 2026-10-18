# Fixtures de saúde ocupacional — trechos REAIS (NR-07, CLT, LGPD)

Os `.txt` desta pasta contêm SOMENTE o texto extraído dos itens/artigos indicados, exatamente como o pipeline o
produz (sem cabeçalho, para o parser ver o mesmo que produção veria). Usados por
`test/saude-ocupacional-seed.unit-spec.ts` para validar os dois seeds da área: `db/seed-data/normative-rules/saude-ocupacional-nr07.json`
(regras só da NR-07) e `db/seed-data/normative-rules/saude-ocupacional.json` (regras com CLT, NR-01 ou LGPD).
Não editar à mão: o teste confere o sha256 de cada trecho.

A NR-01 usada pelo mesmo teste é o texto vigente inteiro já versionado em
`test/fixtures/normative/NR-01-vigente-2026-05-26.txt` (origem no plano/ledger do GRO/PGR; sha256
`afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0`); o seed só liga os subitens 1.8.6, 1.8.7, 1.8.7.1
e 1.8.8, que tratam da dispensa do PCMSO. O teste também usa a NR-01 ANTERIOR (`db/seed-data/normative-sources/NR-01.txt`)
para fixar que, contra ela, só a ligação 1.8.7.1 deixa de resolver (lá o mesmo texto é o 1.8.6.1).

Data de obtenção: **2026-10-10**.

## Método

- **NR-07** (PDF oficial): o texto é o de `db/seed-data/normative-sources/NR-07.txt` (extração do PDF com o
  `pdf-parse` do monitor; idêntico byte a byte ao texto vigente em produção, hash `682207e135ad…`). O recorte é
  `texto.slice(char_start de "7.5", char_end de "7.6.6") + '\n' + texto.slice(char_start de "7.7.1", char_end de "7.7.4") + '\n'`
  (offsets de `parseProvisions(texto, 'nr')`). O título "7.7 MICROEMPREENDEDOR INDIVIDUAL - MEI, …" (2 linhas, entre
  7.6.6 e 7.7.1) fica de fora: no texto inteiro ele não vira dispositivo (o sumário do início repete "7.7" e o parser
  marca `item_ambiguo`), e no recorte viraria. Conferido em 2026-10-10 (e repetido pelo teste): para os 45 dispositivos
  do recorte, `parseProvisions(recorte, 'nr')` devolve os MESMOS endereços e literais (anexo `''`) que o texto
  inteiro; 0 anomalias.
- **CLT e LGPD** (Planalto, baixadas com o User-Agent do monitor, `MONITOR_FETCH_HEADERS`; as páginas inteiras não
  entram no repositório):

  ```ts
  const text = extractHtmlText(decodeHtmlBuffer(buf, 'text/html; charset=iso-8859-1'), PLANALTO_EXTRACT_OPTIONS);
  // trecho = text.slice(char_start do 1º dispositivo, char_end do último) por intervalo, unidos por '\n', + '\n'
  parseProvisions(trecho, 'lei');
  ```

  Conferido em 2026-10-10: para cada trecho, `parseProvisions(trecho, 'lei')` devolve os MESMOS endereços e literais
  (mesma ordem, mesmo texto) que `parseProvisions(páginaInteira, 'lei')` para esses artigos; 0 anomalias. Cada
  `contem` do seed ligado à CLT/LGPD aparece UMA vez também na página inteira extraída (conferido fora do teste).

## Arquivos

| Arquivo | Norma (`norma`) | Origem | sha256 da fonte inteira | Recorte | sha256 do trecho | Dispositivos |
|---|---|---|---|---|---|---|
| `nr-07-itens.txt` | `NR-07` | https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/nr-07-atualizada-2022-1.pdf | texto extraído (`NR-07.txt`, 72 349 caracteres): `682207e135ad01e3d29e607fb7bb56e704a9ee0c215ba05c0a60075d3f5dfda4` | itens 7.5 a 7.6.6 e 7.7.1 a 7.7.4 do corpo | `ecbe2b8e0480a9197a041218a553b7f395c1a0d5294a2b0d1b5ba247dc8f1f02` | 45 |
| `clt-arts-168-169.txt` | `CLT` | https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm | página (bytes baixados): `5ec29acf5b53bb0de3ccc643ecbafc555cd4285d83e5510a879692d619a55851`; texto extraído: `bdff7451c8e7ec12985bfe67b01f7ce9ca45d43ed664e7d079041c353cbb15e7` | de `Art. 168 - Será obrigatório` até o fim do art. 169 | `a1e74386b97d29a440365f71c7624e3b713ee23325dcd5332adb28db31a61060` | 12 |
| `lgpd-arts-5-11-46-48.txt` | `LEI-13709` | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709compilado.htm | página (bytes baixados): `989b7aecbf590b39ba22649dce5696f8f87a020bd2fd2ec3d7c4a9997ebd5d4f`; texto extraído: `9e3025d8f436c3cafad856bbfe95ffac4a1aeae3b919e27917fd8ea00759bfec` | 4 intervalos: art. 5 (caput e incisos I–XIX), art. 11 (caput, incisos, §§ 1º–5º), art. 46 (caput, §§ 1º–2º), art. 48 (caput, §§ 1º–3º) | `52a2d3551bf1cfe7946f707393632f4146f579b7521631b7da78eaa1cc312684` | 45 |

Formas da fonte mantidas no literal (não corrigir): "135 (centro e trinta e cinco) dias" na NR-07 7.5.11; marcas de
página do PDF ("-- 3 of 39 --") dentro dos literais da NR-07; `§ 6 o`/`§ 7 o`/`Lei n o` na CLT; notas
"(Redação dada…)", "(Incluído…)", "Vigência" no fim dos literais do Planalto. O `contem` das ligações do seed usa
trechos que evitam essas formas.
