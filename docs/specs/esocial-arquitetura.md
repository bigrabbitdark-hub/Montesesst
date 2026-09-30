# Spec: Arquitetura do módulo eSocial SST (Sub-projeto 1)

## Status das fontes

Este documento usa os rótulos exigidos pelo AGENTS.md: **VERIFICADO** (fonte oficial
confirmada por leitura direta), **INFERIDO** (convergência forte de múltiplas fontes
secundárias independentes, não confirmado contra o texto primário), **NÃO VERIFICADO**
(não foi possível confirmar de forma alguma). Nenhum prazo, obrigação ou estrutura de
leiaute foi inventado — onde a fonte primária (Manual de Orientação do eSocial, MOS)
não pôde ser lida (os PDFs oficiais retornaram como imagem não extraível durante a
pesquisa), isso está declarado explicitamente abaixo. **Nenhuma regra rotulada INFERIDO
deve virar lógica de negócio travada sem confirmação humana contra o MOS S-1.3 vigente
baixado localmente.**

## Contexto — o que já existe

Auditoria completa do repositório (2026-09-29) confirmou: **o módulo eSocial é 100%
greenfield**. Nenhuma linha de código, dependência, tabela ou config relacionada a
certificado digital, XML, assinatura, SOAP ou eSocial existe hoje. `PRODUCT.md` afirma
categoricamente que não há automação de envio ao eSocial — este projeto muda essa
postura de produto (decisão confirmada com o fundador); a atualização do `PRODUCT.md`
faz parte da Task 1 do plano de implementação.

Stack confirmada: NestJS 10 + TypeScript, `pg` puro (sem ORM, migrations SQL sequenciais
em `backend/db/migrations/`, próxima livre: `0061`), Redis (hoje só rate-limit), R2/S3
para todo arquivo (nunca disco/DB), `@nestjs/schedule` para assíncrono (sem fila
Bull/BullMQ). RLS com `FORCE ROW LEVEL SECURITY` em 48/48 tabelas com `tenant_id`, com
dois testes de proteção automática (`tenant-isolation-sweep.e2e-spec.ts` varre o catálogo
do Postgres; `tenant-context-callsites.unit-spec.ts` varre estaticamente o código-fonte) —
qualquer tabela/call-site novo do eSocial cai sob essas travas automaticamente.

Nenhum dos dados de origem dos eventos SST existe hoje de forma estruturada: ASO não
existe (só um checkbox de checklist de inspeção), PGR/inventário de risco/agentes nocivos
não existe (só PDF genérico categorizado), acidente/CAT não existe. `employees` não tem
matrícula, CBO nem categoria/vínculo. `company_units`/`tenants` não têm CNAE nem código
de estabelecimento eSocial.

## Decisão de escopo (confirmada com o fundador via brainstorming)

| Decisão | Escolha |
|---|---|
| Custódia de certificado | Certificado próprio do cliente (upload .pfx/.p12 + senha, armazenado com envelope encryption) desde a Fase 1 — não só procuração |
| Postura de produto | Atualizar `PRODUCT.md` para refletir capacidade real de transmissão (nasce em Produção Restrita) |
| Infra assíncrona | `@nestjs/schedule` (cron), seguindo o padrão dos 4 crons já existentes — sem introduzir fila nova nesta fase |
| Gestão de chave mestra | Envelope encryption com chave mestra em variável de ambiente (mesmo padrão de `GOOGLE_TOKEN_ENCRYPTION_KEY`), migrável para KMS real depois sem recifrar dado |
| Escopo de envio | Só eventos SST (S-2210/S-2220/S-2240/S-3000). Eventos de tabela/vínculo (S-1000, S-2200, S-2300, S-2190) são responsabilidade do sistema de folha do cliente — a Montese depende deles, nunca os envia |
| Evento piloto | S-2220 (Monitoramento da Saúde do Trabalhador) |
| Escopo de UI da Fase 1 | Backend completo + 1 tela mínima de status (certificado + lista de eventos). Dashboard rico, central de rejeições, notificações ficam para sub-projeto de UI dedicado |

## Roadmap de sub-projetos (visão geral)

Cada um é seu próprio ciclo spec → plano → implementação. Só o Sub-projeto 1 está
detalhado nesta spec.

1. **Fundação + certificado + piloto S-2220** (esta spec) — schema base, adapter
   `eSocialProvider`, versionamento de leiaute, módulo `aso/`, certificado A1 do cliente,
   diagnóstico mínimo, fluxo ponta a ponta do S-2220 em Produção Restrita, UI mínima.
2. **Procuração eletrônica** — segunda opção de custódia (Montese como procuradora,
   certificado próprio da Montese), wizard de configuração, distinção visual
   certificado-vs-procuração.
3. **S-2240 (Condições Ambientais)** — exige módulo novo de inventário de risco/agentes
   nocivos estruturado (hoje só PDF genérico) como pré-requisito de dado.
4. **S-2210 (Comunicação de Acidente) + S-3000 (exclusão) generalizado** — módulo novo de
   registro de acidente/CAT estruturado.
5. **Central eSocial (UI completa)** — dashboard rico, central de rejeições com
   corrigir/reenviar, histórico visual, downloads, notificações de vencimento.
6. **Observabilidade + assistente integrado** — métricas, integração com o Assistente
   Montese SST para perguntas sobre eventos/certificado/rejeições.

## Arquitetura de módulos (Sub-projeto 1)

Seguindo o padrão "um módulo por domínio" já usado nos 35 módulos existentes:

```
backend/src/esocial/
  esocial.module.ts
  esocial-provider.interface.ts   # adapter: generateEvent/validateEvent/signEvent/
                                   # sendEvent/consultEvent/deleteEvent/getStatus
  certificates/
    certificates.controller.ts    # upload, validar, listar metadados, remover
    certificates.service.ts
    certificate-crypto.service.ts # envelope encryption/decryption
    pkcs12.util.ts                # parsing .pfx via node-forge
  events/
    s2220-event-builder.ts        # traduz aso_records -> payload do evtMonit
  xml/
    xml-generator.service.ts
    xml-signer.service.ts         # xml-crypto: enveloped + C14N + RSA-SHA256
  transmission/
    esocial-soap-client.service.ts
    transmission-queue.cron.ts    # cron: RASCUNHO -> ... -> PROCESSADO/REJEITADO
  diagnostics/
    esocial-diagnostics.service.ts
  esocial-status.controller.ts    # tela mínima de status (certificado + eventos)

backend/src/aso/                  # módulo novo, peer de epi/caepi — dado de SST puro,
  aso.module.ts                   # reaproveitável independente do eSocial
  aso.controller.ts
  aso.service.ts
```

`esocial-provider.interface.ts` é a única superfície que o resto do sistema (diagnóstico,
UI, futuro assistente) conhece — a implementação concreta (node-soap hoje, envelope
manual se necessário depois) fica isolada atrás dela, conforme o padrão "interface por
capacidade" já usado no módulo `normative`.

## Fluxo ponta a ponta (S-2220)

```
ASO registrado (aso/)
  -> Diagnóstico eSocial (diagnostics/): campos obrigatórios presentes?
     certificado válido? confirmação explícita de vínculo já existente no eSocial?
  -> RASCUNHO: esocial_events criado com payload_json completo
  -> VALIDANDO: s2220-event-builder monta o XML do evtMonit (xml-generator)
  -> ASSINADO: xml-signer assina (chave extraída do certificado do tenant,
     decifrada em memória, nunca persistida em PEM)
  -> AGUARDANDO_TRANSMISSAO: entra na fila (cron)
  -> TRANSMITINDO: esocial-soap-client envia lote de 1 evento (ambiente configurado
     por esocial_layout_versions: Produção Restrita nesta fase)
  -> TRANSMITIDO -> PROCESSANDO: cron de consulta pergunta o resultado do lote
  -> PROCESSADO (grava nr_recibo) ou REJEITADO (grava código/mensagem do eSocial)
     ou ERRO_TECNICO (falha de rede/timeout, retry com backoff)
```

Cada transição de estado grava uma linha em `esocial_event_history` (append-only, mesmo
padrão de proteção via `REVOKE` que já protege `audit_log`).

**Retificação**: reenvio do evento COMPLETO (não diff) com `indRetif=2` +
`nr_recibo` do evento anterior válido — por isso o payload completo é sempre persistido
por versão, nunca só o delta (INFERIDO, seção "Retificação e exclusão" abaixo).

**Exclusão (S-3000)**: sempre referencia o `nr_recibo` mais recente válido daquela
"entidade de negócio" (aqui, por `aso_record`) — se já houve retificação, é o recibo da
retificação, não do original.

**Idempotência**: `esocial_events` tem `idempotency_key` único (`tenant_id` +
`aso_record_id` + `versao`) — clique duplo no botão de transmitir não cria segunda linha.

## Pré-requisitos (INFERIDO — múltiplas fontes secundárias convergentes)

O S-2220 exige que o trabalhador já exista no eSocial via S-2200 (admissão), S-2300
(TSVE) ou S-2190 (registro preliminar), e que o empregador já tenha eventos de tabela
(S-1000) enviados. **Isso é responsabilidade do sistema de folha/contabilidade do
cliente, não da Montese** (decisão de escopo confirmada acima). Como a Montese não
implementa "consultar identificadores" nesta fase, o Diagnóstico eSocial:

1. Verifica os campos que a própria Montese precisa (CPF válido, matrícula preenchida,
   dados do exame completos).
2. Exige confirmação explícita (checkbox, sem valor pré-marcado) do técnico/empresa de
   que o vínculo já está registrado no eSocial — nunca presume isso silenciosamente.

Risco documentado: na prática, é esperado que alguns S-2220 sejam rejeitados por
sequenciamento (folha do cliente ainda não enviou o vínculo) — o fluxo de
rejeição→correção→reenvio precisa tratar esse código de erro especificamente com uma
explicação clara ("aguarde o sistema de folha enviar o vínculo do trabalhador").

## Estrutura do evento S-2220 (INFERIDO — ver nota de fonte)

**Nota de fonte**: os PDFs oficiais do Manual de Orientação (MOS) retornaram como imagem
não extraível durante a pesquisa. A estrutura abaixo vem de convergência entre 3 fontes
secundárias técnicas independentes (Senior, RSData, e nomes de tag confirmados em
mensagens de erro de validação XSD documentadas pela Alterdata) — alta confiança, mas
**precisa ser confirmada contra o XSD oficial baixado localmente antes da Task de
implementação que gera os tipos TypeScript do evento**.

Blocos do `evtMonit`:
- `ideEvento` — indicador de retificação, nº de recibo a retificar, ambiente (produção/
  restrita), processo de emissão do lote.
- `ideEmpregador` — CNPJ/CPF/CNO do empregador (deve bater com o que já existe no eSocial
  via evento de tabela do sistema de folha).
- `ideVinculo` — CPF + matrícula + categoria do trabalhador — ponto de acoplamento com
  S-2200/S-2300/S-2190.
- `exMedOcup` — tipo de exame (admissional/periódico/retorno/mudança de função/
  monitoração pontual/demissional):
  - `aso` — data de emissão, resultado (apto/inapto), indicador de autorização de
    divulgação do resultado (`indResult` — ponto de minimização de dados/consentimento).
    - `exame` — avaliações/exames complementares (procedimento, data, resultado).
    - `medico` — nome, CRM, UF do CRM do médico emissor.
  - `respMonit` — médico coordenador do PCMSO (CPF, nome, CRM, UF) — dado novo, não
    existe hoje nem por tenant.

Risco/agente nocivo **não** está no S-2220 — vive no S-2240 (fora de escopo desta fase).

## Ambientes e transmissão

- **Produção Restrita** (VERIFICADO, `gov.br/esocial`): ambiente de testes sem efeito
  legal, limite de 1.000 vínculos por empregador, não é ambiente de teste de carga.
  Endpoints confirmados: envio `https://webservices.producaorestrita.esocial.gov.br/
  servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc`; consulta
  `.../consultarloteeventos/WsConsultarLoteEventos.svc`.
- **Produção**: URLs **NÃO VERIFICADAS** contra fonte primária (falha de conexão no
  domínio legado durante a pesquisa) — vêm de fonte secundária e **já mudaram pelo menos
  uma vez no passado** segundo notícia oficial encontrada. Nunca hardcode: endpoint por
  ambiente fica em `esocial_layout_versions`, confirmado contra o Pacote de Comunicação
  oficial no momento da implementação, nunca contra esta spec.
- Comunicação: SOAP 1.1 com autenticação mútua TLS (mTLS) usando o certificado A1/A3
  ICP-Brasil do tenant (INFERIDO por forte convergência de fontes técnicas — não
  confirmado contra o texto literal do MOS).
- Assinatura: XMLDSig enveloped, canonicalização C14N, RSA-SHA256, certificado 2048 bits
  (INFERIDO — uma fonte indicou que o algoritmo já foi SHA-1 no passado e mudou para
  SHA-256; confirmar contra o MOS vigente antes de travar o algoritmo no código).
- Sub-projeto 1 opera **exclusivamente em Produção Restrita**. Produção real só depois do
  critério de aceite completo (abaixo) e autorização explícita do fundador.

## Bibliotecas (todas verificadas no npm registry em 2026-09-29 — reconfirmar antes de
fixar versão em `package.json`)

| Necessidade | Escolha | Versão | Licença | Por quê |
|---|---|---|---|---|
| mTLS de transporte | `tls`/`https.Agent` nativo do Node | — | — | Aceita `{pfx, passphrase}` diretamente, sem dependência extra |
| Extrair chave/cert do PFX em PEM | `node-forge` | 1.4.0 | BSD-3-Clause/GPL-2.0 dual | API madura para PKCS#12, alimenta o `xml-crypto` |
| Assinatura XML | `xml-crypto` | 6.3.2 | MIT | Suporta exatamente enveloped + C14N + RSA-SHA256 |
| Cliente SOAP | `soap` (node-soap) | 1.13.1 | MIT | `ClientSSLSecurityPFX` nativo; encapsulado atrás do adapter — troca para envelope manual (axios + `https.Agent`) se a geração dinâmica de WSDL falhar contra o WSDL real (risco conhecido de WSDLs de governo), sem afetar o resto do sistema |

## Avaliação dos projetos open source citados

| Solução | Linguagem | Licença | Manutenção | Cobertura eventos SST | Reuso direto | Recomendação |
|---|---|---|---|---|---|---|
| TST eSocial-JT (`tst-labs/esocial`) | Java | BSD-3-Clause | Ativo (push 2026-09-03) | Genérica (todos eventos) | Não (linguagem diferente) | Referência **conceitual**: separação schemas/domínio/comunicação, endpoint REST interno de "ocorrências", processamento em lote periódico — padrões portados para o design acima |
| `qualitaocupacional/libesocial` | **Python** (não PHP — correção de premissa, confirmado via GitHub API) | Apache-2.0 | Inativo (último push 2024-08-22, >2 anos) | Focada em SST, cobertura exata não confirmada sem inspecionar código | Não (linguagem diferente + inatividade) | Referência de domínio (nomenclatura SST), não de código — mantida por empresa do mesmo setor |
| `erpbrasil/esociallib` | Python | MIT | Ativo (push 2026-08-12) | Confirma S-2210, S-2220, S-2240 explicitamente + ~50 outros | Não (linguagem diferente) | Referência arquitetural mais forte: separa geração XML / assinatura / transmissão em 3 componentes independentes — mesma fronteira usada no design de módulos acima (`xml/`, `certificates/`, `transmission/`) |

Nenhuma biblioteca é reutilizável diretamente (Java/Python vs. stack NestJS/TypeScript).
XSDs oficiais devem ser sempre baixados da fonte oficial (`gov.br/esocial`), nunca
vendorizados de repositório de terceiro — mesmo o `erpbrasil/esociallib` trata a fonte
oficial como verdade, não o inverso.

## Segurança

Detalhado em `esocial-seguranca.md`. Resumo: certificado do cliente nunca em texto puro
(envelope encryption, chave mestra nova em env), nunca em log, RLS completa em toda
tabela nova, isolamento total entre tenants (certificado do Tenant A nunca acessível pelo
Tenant B, mesmo por admin técnico comum).

## Versionamento de leiaute

Tabela `esocial_layout_versions` centraliza: versão do leiaute vigente (S-1.3,
VERIFICADO), URL/versão dos endpoints por ambiente, data de vigência. Nenhuma versão
espalhada pelo código — todo lugar que precisa saber "qual versão estou usando" lê desta
tabela. Atualização de leiaute (nova NT) é operação administrativa (novo row + data de
corte), não deploy de código, na medida do possível.

## Riscos conhecidos (itens NÃO VERIFICADOS que precisam confirmação humana)

1. Estrutura campo-a-campo exata do `evtMonit` — confirmar contra XSD oficial antes de
   gerar tipos TypeScript (Task dedicada no plano de implementação).
2. Prazo de envio do S-2220 (dia 15 do mês seguinte — INFERIDO) — confirmar contra MOS
   antes de virar regra de alerta de vencimento.
3. Algoritmo de assinatura exato (RSA-SHA256 vs. SHA-1 histórico) — confirmar contra MOS
   vigente antes de travar no `xml-signer.service.ts`.
4. URLs de Produção (não-restrita) — confirmar contra Pacote de Comunicação oficial no
   momento da implementação da Task de transmissão real (fora do escopo do piloto em
   Produção Restrita).
5. Custódia de certificado próprio do cliente é uma responsabilidade legal maior do que
   procuração eletrônica (o próprio MOS/RFB desaconselham prestador simplesmente receber
   certificado e senha do titular) — decisão já confirmada com o fundador, mas deve ficar
   documentada como escolha consciente, não default silencioso.
6. Dado de ASO é dado de saúde sob a LGPD — retenção/minimização definitiva precisa
   validação jurídica antes de produção real, não é decisão técnica pura (ver
   `esocial-seguranca.md`).

## Critério de aceite — Sub-projeto 1

- [ ] Certificado A1 pode ser enviado, validado (estrutura PKCS#12, validade, titular) e
      armazenado com envelope encryption
- [ ] Senha do certificado nunca aparece em log, resposta de API ou texto puro no banco
- [ ] Diagnóstico eSocial identifica corretamente o que falta por trabalhador/empresa
      antes de permitir transmissão
- [ ] XML do S-2220 é gerado, assinado (XMLDSig) e validado estruturalmente
- [ ] Evento é transmitido em Produção Restrita, consulta de processamento funciona
- [ ] Sucesso (nr_recibo) e rejeição (código + mensagem) são armazenados e distinguíveis
- [ ] Evento duplicado (clique duplo) não gera segunda transmissão (idempotência)
- [ ] `esocial_event_history` registra toda transição com ator e timestamp
- [ ] Toda tabela nova passa no `tenant-isolation-sweep.e2e-spec.ts` sem exceção
- [ ] Teste `*-rls.e2e-spec.ts` dedicado para certificados e eventos (Tenant A não acessa
      dado do Tenant B)
- [ ] `PRODUCT.md` atualizado refletindo a nova capacidade (em Produção Restrita)
- [ ] Testes automatizados cobrindo certificado inválido/expirado, XML inválido, evento
      duplicado, cross-tenant access, timeout de rede

## Fora de escopo desta fase (fica para sub-projetos 2-6)

Procuração eletrônica, S-2210/S-2240/S-3000 generalizado, dashboard rico, central de
rejeições com UI de correção, notificações de vencimento, observabilidade/métricas,
integração com o Assistente Montese SST, Produção real (não-restrita).
