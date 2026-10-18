# eSocial SST — O TST eSocial-JT como referência e oráculo (spec)

> **Status: DESENHO APROVADO em 2026-10-05.** Só documentação. Nenhum código de produto, container ou serviço novo é criado por este documento.
> Complementa `esocial-arquitetura.md`, `esocial-seguranca.md` e `esocial-mapeamento-dados.md`. Plano de execução:
> `docs/superpowers/plans/2026-10-05-esocial-montese-tst-referencia.md`.
> Marcadores (AGENTS.md): **VERIFICADO** = li no código/README do TST ou no oficial. **EVIDÊNCIA SECUNDÁRIA FORTE** = o TST (sistema que o governo
> processou) faz assim, mas **não** conferi com o texto oficial vigente. **INFERIDO**, **NÃO VERIFICADO** como de costume.
> Fonte lida: `https://github.com/tst-labs/esocial`, clone raso em 2026-10-05, commit `90f48d6` (2026-09-03), 5.391 arquivos, licença BSD-3-Clause.

## 1. Decisão

**Não** colocar o TST em produção nem criar um serviço Java. **Ler** o TST (somente leitura) e **reimplementar em NestJS** as tasks de transmissão
(13 a 19 do plano original), usando o TST como **evidência** do que o governo aceita e como **material de teste**. A verdade é sempre o **eSocial oficial vigente**.

### 1.1 Alternativas avaliadas

| Opção | Resumo | Decisão | Motivo |
|---|---|---|---|
| **Referência e oráculo** | Estudar e portar a lógica para NestJS; fixtures e XSD de referência | **ESCOLHIDA** | Mantém multi-tenant e certificado cifrado; sem Java; reduz o risco INFERIDO |
| Sidecar do TST só no piloto | Uma instância Java em "Opção 3" (3 endpoints REST que o Montese implementaria) | Descartada por ora | Um empregador e um certificado por instalação; container Java novo (infra) |
| Microserviço próprio multi-tenant (fork) | `montese-esocial-transmitter` derivado do TST | Descartada | Reescrever empregador único e certificado por requisição; Java 8; fork a manter; nova superfície com certificados de clientes |
| Plano original | Tasks 13 a 19 do zero, só pelos documentos oficiais | Descartada | Mantém o maior risco (XML, assinatura e SOAP INFERIDOS) sem evidência |

## 2. O que o TST é (VERIFICADO)

- Projeto do TST, **Java 8 + Spring Boot**, JDK 8, Maven, PostgreSQL, Docker. README: *"[PROJETO EM DESENVOLVIMENTO]… API ainda em desenvolvimento e portanto instável"*. 39 issues abertas.
- Módulos: `esocial-esquemas` (52 XSD), `esocial-comunicacao` (WSDL), `esocial-jt-dominio`, `esocial-jt-service` (API REST), `cockpit`, `frontend`.
- **Um empregador e um certificado A1 por instalação** (`esocialjt.cnpj-empregador`, `esocialjt.arquivoCertificado`, `esocialjt.senhaCertificado`). **Não é multi-tenant.**
- Eventos: S-2210, S-2220, S-2240, S-3000 (e outros). Só A1. **Não faz validação semântica.**
- API: `POST/GET /esocial-jt-service/ocorrencias`; a "Opção 3" delega assinatura, envio de lote e consulta a **3 endpoints REST externos**.
- **Ativo:** último commit em 2026-09-03; em 2026-07-02 *"Habilita CNPJ alfanumérico e atualiza XSD"*. Commits recentes co-assinados por ferramenta de IA.
- README declara pacote **S-1.3 (NT 03/2025)**, mas os XSD foram atualizados em 07/2026. O eSocial oficial publicou depois a **NT S-1.3 nº 07/2026 (04/09/2026, revisada em 24/09/2026)**.
  Um nome de arquivo indexado sugere MOS consolidada "até a NT 10/2026": **NÃO VERIFICADO**. Logo, **os XSD do TST devem ser tratados como possivelmente defasados**.

## 3. O que a leitura resolveu (item do nosso spec → evidência)

Todos EVIDÊNCIA SECUNDÁRIA FORTE: confirmar contra o **MOS e o XSD oficiais vigentes** antes de fixar em código.

| Item (spec `esocial-arquitetura.md`) | Antes | Evidência no TST | Onde no TST |
|---|---|---|---|
| Estrutura do `evtMonit` (S-2220) | INFERIDO | `ideEvento`, `ideEmpregador`, `ideVinculo`, `exMedOcup` (`tpExameOcup`, `aso`: `dtAso`, `resAso`, `exame`: `dtExm`, `procRealizado`, `obsProc`, `ordExame`, `indResult`; `medico`: `nmMed`, `nrCRM`, `ufCRM`), `respMonit` (`cpfResp`, `nmResp`, `nrCRM`, `ufCRM`). Namespace `…/schema/evt/evtMonit/v_S_01_03_00` | `esocial-esquemas/src/main/resources/xsd/evtMonit.xsd` |
| Algoritmo de assinatura | INFERIDO (RSA-SHA256 × SHA-1) | **`rsa-sha256`**, digest **`sha256`**, transformações **`enveloped-signature` + `xml-c14n-20010315`** (C14N 1.0), **`Reference URI=""`**, certificado X509 no `KeyInfo`, **sem prefixo `ds:`** | `esocial-jt-service/.../xml/assinatura/AssinaturaXmlServico.java` |
| URLs de Produção Restrita | VERIFICADO | **Idênticas** às nossas | `esocial-jt-service/.../comunicacaogov/ComunicacaoParametros.java` |
| URLs de Produção real | NÃO VERIFICADO | O TST usa `webservices.envio.esocial.gov.br` (envio) e `webservices.consulta.esocial.gov.br` (consulta). **Ainda NÃO VERIFICADO no oficial; não gravar no banco antes disso** | idem |
| SOAPAction | desconhecido | `…/lote/eventos/envio/v1_1_0/ServicoEnviarLoteEventos/EnviarLoteEventos` e `…/consulta/retornoProcessamento/v1_1_0/ServicoConsultarLoteEventos/ConsultarLoteEvento` | idem |
| Lote | não detalhado | Lote **por grupo de tipo de evento**; leva `ideEmpregador` e **`ideTransmissor`** (`tpInsc`, `nrInsc`) à parte do empregador; README: até **50 eventos por lote** e **10 lotes por ciclo** | `.../xml/GeradorLote.java`; README |
| Estados do lote | não detalhado | `PROCESSAMENTO` → `PROCESSADO_COM_SUCESSO` / `PROCESSADO_COM_ERRO` / `ERRO` | `.../negocio/MaquinaEstadoLote.java` |
| Retificação | INFERIDO | `operacao=RETIFICACAO` + `retificarRecibo` → `<indRetif>2</indRetif>` com o nº do recibo; normal → `<indRetif>1</indRetif>` | `GeradorXmlMonitTest.java` |
| ID do evento | desconhecido | `xs:ID` de **36 caracteres** (exemplo: `ID1005099680001482017092708200100001` = `ID` + tipo de inscrição + CNPJ de 14 + data/hora + sequência) | `tipos.xsd` (`TS_Id`) |
| **CNPJ** | — | **`[A-Z0-9]{12}\d{2}`** (alfanumérico, 14 caracteres) | `tipos.xsd` (`TS_cnpj`) |
| Tentativas e falhas | desconhecido | Limite máximo de tentativas de envio por evento (`NUMERO_MAXIMO_ENVIOS`); commit de 03/09/2026 *"impede que evento sem regra cadastrada derrube o ciclo de envio"* | `.../negocio/EnvioServico.java` |
| Exemplo real de S-2220 (entrada) | não tínhamos | JSON de ocorrência `MONIT` (`ideEmpregador`, `ideVinculo` com `cpfTrab` + `matricula`, `exMedOcup`, `aso`, `exame[]`, `medico`) | `esocial-jt-service/src/main/resources/exemplos/monit.json` |

**Correção de algo que eu disse antes:** o teste do gerador de XML do TST **não** traz um XML esperado completo; só confere `contains("evtMonit")` e `indRetif`.
Portanto **não existem "golden files" prontos**. A estratégia de teste está na seção 6.

## 4. O que NÃO copiar (achados na leitura)

1. **O TST desliga a verificação de hostname no TLS:** `messageSender.setHostnameVerifier((hostname, session) -> true)` (`ComunicacaoConfig.java`). O nosso cliente **verifica hostname e cadeia** (âncoras de confiança ICP-Brasil do servidor do governo).
2. **Senha do certificado em arquivo de propriedades** e **um certificado/CNPJ por instalação:** o Montese tem certificado **cifrado por tenant**, nunca em disco (spec de segurança §1).
3. **Java 8 + Spring** e o ciclo por temporizador de 10 s (`periodoAutoMilis`): fora do nosso stack; o nosso cron segue o padrão do projeto, só com evento **autorizado por humano**.
4. **Sem validação semântica:** o TST confia no sistema de origem. O Montese valida (Diagnóstico) **antes** de criar o evento.

## 5. Licença (BSD-3-Clause, `LICENSE.md`: "Copyright 2021 TST")

- Permite uso e redistribuição **mantendo o aviso de copyright, a lista de condições e o aviso legal**, e **sem usar o nome do TST para endossar** o produto.
- **Regra do projeto:** **reimplementar a lógica** em TypeScript, sem copiar arquivos Java. Qualquer artefato **copiado** (ex.: `monit.json` como fixture de teste) fica identificado em `THIRD_PARTY_NOTICES.md` com o aviso BSD-3.
- **XSD:** a fonte de verdade é o **pacote oficial do gov.br**, baixado por uma pessoa. O XSD do TST serve só de **comparação**, nunca de origem (o spec original já exige isso).
- "Tratar a licença de cada componente individualmente" (cautela correta): **NÃO VERIFICADO** se algum arquivo do repositório tem licença própria; a verificação é uma task do plano.

## 6. Estratégia de teste (sem "golden files" prontos)

1. **Validação contra o XSD oficial** do evento gerado (a prova mais forte e independente do TST).
2. **Fixtures de entrada:** `monit.json` (BSD-3, com atribuição) adaptado ao nosso payload.
3. **Comparação opcional com o gerador do TST:** rodar o gerador dele (JDK 8 + Maven, em **container descartável e isolado**, sem certificado) para produzir um XML de comparação e diferenciar campo a campo.
   **Isto exige sua autorização** (baixar imagens e rodar container), e não é pré-requisito.
4. **Assinatura:** teste de ida e volta (assinar e verificar) com o certificado de teste **gerado**; conferir a **forma** (algoritmos, transformações, `URI=""`, sem prefixo) contra a tabela da seção 3.
5. **Produção Restrita real:** só na Task 23, com certificado A1 de teste e credenciamento. É a única prova final.

## 7. Fronteiras (o que o Montese decide e o que a transmissão faz)

- **Montese decide:** quem é o trabalhador, o vínculo, o ASO, o médico, se o evento deve existir, o Diagnóstico e a **autorização humana** (empresa e técnico vinculado; autor e hora gravados).
- **A camada de transmissão** (módulo NestJS `esocial/`) **só executa o que foi autorizado:** XML, XSD, assinatura, lote, SOAP/mTLS, consulta e registro do retorno. Não decide regra de SST.
- Desenho aprovado das lacunas G-01 a G-04: `docs/superpowers/specs/2026-10-04-esocial-lacunas-g01-g04-design.md`.

## 8. Verificação contra o oficial (tarefa humana, antes de qualquer teste em Produção Restrita)

Baixar em `gov.br/esocial` (documentação técnica) o pacote **vigente** e conferir:

- [ ] **XSD S-1.3** da **NT nº 07/2026 (revisada em 24/09/2026)** e posteriores: `evtMonit` (namespace e versão), `tipos.xsd` (`TS_cnpj`, `TS_Id`), `envioLoteEventos`, `retornoProcessamento`. Comparar com os 52 XSD do TST e listar divergências.
- [ ] **MOS S-1.3 consolidada**: regras do S-2220 (obrigatoriedade de `respMonit`, `indResult`, prazo de envio), grupos de eventos e limites de lote.
- [ ] **WSDL e SOAPAction** de envio e consulta (versão `v1_1_0` ainda vigente?).
- [ ] **URLs de Produção real** e a cadeia de certificados do servidor (para as âncoras de confiança).
- [ ] **Algoritmo e forma da assinatura** (tabela da seção 3).
- [ ] **CNPJ alfanumérico:** regra de cálculo do dígito verificador e vigência (ver tarefa N8 do plano).

## 9. Riscos

| Risco | Mitigação |
|---|---|
| XSD/regras do TST defasados em relação à NT 07/2026 | Seção 8 antes de qualquer teste; o oficial prevalece |
| Copiar a fraqueza de segurança do TST (hostname) | Seção 4 virou requisito da Task 17, com teste |
| Licença | Seção 5; reimplementar, atribuir fixtures |
| Dependência de conhecimento de um projeto "instável" | O TST é referência, não dependência; nada dele entra no build |
| Falso conforto ("o TST já fez") | Rótulo EVIDÊNCIA SECUNDÁRIA FORTE até a conferência oficial |

## 10. Mapa de referência: tasks do plano → arquivos do TST (somente leitura)

Raiz: `src/esocial-jt-service/src/main/java/br/jus/tst/esocialjt/` (salvo indicação).

| Task do plano | O que estudar no TST | Arquivo | Montese faz diferente |
|---|---|---|---|
| 13 · tipos e payload do S-2220 | Domínio e mapeamento do evento | `esocial-jt-dominio/.../dominio/monit/ExMedOcup.java`, `ocorrencia/dados/Monit.java`, `mapper/MonitMapper.java`, `regras/evento/RegrasFactory.java` | Tipos TS gerados do **XSD oficial**; payload montado a partir de `aso_records`, não de JSON externo |
| 14 · gerar o XML | Ordem e elementos do `evtMonit`, `Id`, `indRetif` | `xml/gerador/GeradorXmlMonit.java`, `GeradorXmlFactory.java`, `evtMonit.xsd` | Construtor explícito na ordem do XSD (sem JAXB); `Id` de 36 caracteres |
| 15 · assinar | Parâmetros da assinatura | `xml/assinatura/AssinaturaXmlServico.java`, `AssinadorXml.java` | `xml-crypto` com a mesma forma; chave do certificado decifrada em memória |
| 16 · diagnóstico | Regras por evento | `regras/evento/*` | Diagnóstico próprio, com `key` estável por pendência |
| 17 · SOAP/mTLS e lote | Envelope, ações, lote por grupo, `ideTransmissor` | `xml/GeradorLote.java`, `comunicacaogov/ComunicacaoEsocialGov.java`, `ComunicacaoParametros.java`, `esocial-comunicacao/.../wsdl/*` | **Hostname e cadeia verificados**; timeouts; sem certificado em disco |
| 18 · fila e estados | Estados do lote, tentativas | `negocio/MaquinaEstadoLote.java`, `EnvioServico.java`, `ConsultaLote.java`, `LoteServico.java` | Só evento **autorizado**; falha de um evento não derruba o ciclo; autor no histórico |
| 19 · status | Retorno e códigos | `comunicacaogov/RetornoLote.java` | API de status do Montese, com RLS |
