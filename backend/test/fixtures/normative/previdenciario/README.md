# Fixtures previdenciários — trechos REAIS do Planalto

Os `.txt` desta pasta contêm SOMENTE o texto extraído dos artigos indicados, exatamente como o pipeline do monitor
o produz (sem cabeçalho, para o parser ver o mesmo que produção veria). Usados por `test/previdenciario-seed.unit-spec.ts`
para validar `db/seed-data/normative-rules/previdenciario.json`. Não editar à mão: o teste confere o sha256 de cada trecho.

Páginas baixadas em **2026-10-09** com o User-Agent do monitor (`MONITOR_FETCH_HEADERS`). As páginas inteiras
(0,7–3,5 MB) não entram no repositório.

Extração (mesmo caminho do monitor para hosts `*.planalto.gov.br`):

```ts
const text = extractHtmlText(decodeHtmlBuffer(buf, 'text/html; charset=iso-8859-1'), PLANALTO_EXTRACT_OPTIONS);
// trecho = text.slice(início do primeiro artigo, início do cabeçalho seguinte) + '\n'
parseProvisions(trecho, 'lei');
```

Conferido em 2026-10-10: para cada trecho, `parseProvisions(trecho, 'lei')` devolve os MESMOS endereços e literais
(mesma ordem, mesmo texto) que `parseProvisions(páginaInteira, 'lei')` para esses artigos; 0 anomalias.

Regerados em 2026-10-10 (rodada final de correções) depois que o modo Planalto passou a decodificar entidades HTML
(`decodeHtmlEntities` + NFC): só `lei-8213-arts-57-58.txt` mudou (`&#150;` → `–` no art. 57 § 3º); os outros dois
trechos ficaram byte a byte iguais. Acrescentado `dec-3048-art-188-p.txt`; mesma conferência (literais iguais aos da
página inteira, 0 anomalias).

| Arquivo | Norma (`norma`) | Página de origem | sha256 da página (bytes baixados) | Recorte | sha256 do trecho | Dispositivos |
|---|---|---|---|---|---|---|
| `clt-arts-189-192.txt` | `CLT` | https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm | `5ec29acf5b53bb0de3ccc643ecbafc555cd4285d83e5510a879692d619a55851` | de `Art. . 189 - Serão` até antes de `Art. 193. São` | `c5074d850cd6c1a35ddf77696d00df9cb1ff4f8fe0314426b3a2ffa6ea2605fc` | 8 |
| `lei-8213-arts-57-58.txt` | `LEI-8213` | https://www.planalto.gov.br/ccivil_03/leis/l8213cons.htm | `66ce4b43e9b82a670e7ef1fe10225ecd27a1f37f3a8e3251510352f0e16a72e9` | de `Art. 57. A aposentadoria especial` até antes de `Subseção V / Do Auxílio-Doença` | `31c8bdefb813154deb565670e1e889e790f096d9676c70cd43eda8b49f91e371` (antes da decodificação de entidades: `f548618d…`) | 14 |
| `dec-3048-arts-64-70.txt` | `DEC-3048` | https://www.planalto.gov.br/ccivil_03/decreto/d3048.htm (URL INFERIDA pelo nome do arquivo baixado; as outras duas constam do repositório) | `7c02b944ddd2cf2bd69fe05adf81c36b324b3f7326e3f3d244b0dbdc1609a63b` | de `Art. 64. A aposentadoria especial` até antes de `Subseção IV-A` (inclui o art. 70, revogado, que não gera dispositivo) | `17bb82d8addcba2621b769fce7ab69fb51abdeb20c0990a4d9c0d88feae307cd` | 37 |
| `dec-3048-art-188-p.txt` | `DEC-3048` | mesma página do Decreto 3.048 | `7c02b944ddd2cf2bd69fe05adf81c36b324b3f7326e3f3d244b0dbdc1609a63b` | de `Art. 188-P. Ressalvado` até antes de `Art. 188-Q.` | `70290fd82c6cb0d8a6a19723b586de3d038629a77105590b026a90dedb6b727a` | 12 |

Formas da fonte mantidas no literal (não corrigir): `Art. . 189 -`, `§ 1 o`, `caput ,`, o parêntese não fechado no
fim do art. 66 do Decreto 3.048 e a tabela do art. 66 § 2º achatada (uma célula por linha). A tabela do art. 188-P § 5º
é uma IMAGEM na página (`D104102.jpg`) e não aparece no texto: o § 5º termina em "seguinte tabela:". O `contem` das ligações do seed usa trechos que evitam essas formas.
