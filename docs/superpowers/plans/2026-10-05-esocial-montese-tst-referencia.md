# eSocial SST — Plano revisado "Montese + TST como referência" (2026-10-05)

> **Status: PLANO APROVADO como direção; nada executado.** Substitui as **tasks 13 a 19** do plano `2026-09-29-esocial-sst-subprojeto1.md` e **incorpora** as lacunas G-01 a G-04
> (`docs/superpowers/specs/2026-10-04-esocial-lacunas-g01-g04-design.md`, aprovadas). Base: `docs/specs/esocial-referencia-tst.md` (spec desta decisão) e
> `docs/audits/auditoria-esocial-2026-10-04.md`. Contrato de revisão: `docs/operations/checklist-revisao-esocial.md`.
> Regras (AGENTS.md): sem commit/push automático pelo executor, sem produção, sem segredo, **sem ler credencial de produção** (achado E-18), e2e só em ensaio descartável.

## 1. Princípios

1. **O oficial manda.** O TST é evidência e material de teste; nada vai a Produção Restrita sem a verificação oficial (fase V).
2. **Nenhum envio sem autorização humana** registrada (empresa ou técnico vinculado), com autor e hora no evento e no histórico.
3. **Reimplementar em NestJS**, sem copiar código Java e sem container novo. Artefatos copiados (fixtures) levam atribuição BSD-3.
4. **Um certificado por tenant, cifrado**, decifrado só em memória; **hostname e cadeia do servidor do governo verificados** (o TST não faz).
5. **Só Produção Restrita** nesta fase. `producao` bloqueado no serviço e por teste.

## 2. Mapa geral: manter, adaptar, desenvolver, descartar

| Parte | Destino | Observação |
|---|---|---|
| Migrations 0061 a 0065 do eSocial, RLS, histórico append-only | **MANTER** (renumerar; corrigir E-07, E-08) | Rodada 2 do executor |
| Criptografia em envelope, `certificate-crypto`, `pkcs12.util`, `CertificatesService/Controller` | **MANTER e corrigir** (E-04, E-05, E-09, E-10, E-19) | Rodada 2 |
| Módulo ASO | **MANTER e completar** (E-06, E-12, G-04) | Tasks 12b/12c |
| `esocial_events` | **ADAPTAR**: `authorized_by_user_id`, `authorized_at`, `CHECK` de autorização | Task 18a |
| `esocial_layout_versions` | **ADAPTAR**: acrescentar SOAPAction de envio e consulta, namespace do evento e versão do pacote de XSD | Task 14/17 |
| Tasks 13 a 19 do plano original | **SUBSTITUÍDAS** pelas tasks da seção 4 (mesmo objetivo, com referência do TST e requisitos de segurança) | |
| Cron do plano original (`PENDING_STATUSES` com `rascunho`) | **DESCARTAR** | G-03: assinaria e transmitiria sem autorização |
| Serviço Java do TST, sidecar, fork multi-tenant | **DESCARTADO** | spec §1.1 |
| IA do Montese, RLS, diagnóstico SST, ASO/PCMSO | **MANTER** (não tocar) | Fora do escopo |

## 3. Fases e ordem

```
Fase 0 (portão)   Rodada 2 do executor (E-03..E-12, E-19) + decisões abertas (0063, chave, retenção, tabelas oficiais)
Fase A (Montese)  12b dados · 12c ASO completo · 16 diagnóstico · 18a criar/autorizar evento
Fase V (humana)   V1..V5 verificação contra o oficial  ──► libera as tasks 13, 14, 15, 17 em Produção Restrita
Fase B (NestJS)   13 tipos/payload · 14 XML · 15 assinatura · 17 lote+SOAP+mTLS · 18 fila · 19 status · 20 tela
Fase C            21 suíte · 22 PRODUCT.md · 23 validação real em Produção Restrita (certificado A1 de teste)
Separada          N8 CNPJ alfanumérico (Montese inteiro, prioridade sua)
```

As tasks da Fase B podem começar **em paralelo** com a Fase V usando o XSD do TST **apenas como rascunho**, mas **não** passam em Produção Restrita antes da V2 (diferenças contra a NT 07/2026).

## 4. Tasks (cada uma: RED primeiro, teste, relatório com saída real)

### Fase A — Montese (desenho aprovado, G-01 a G-04)

| Task | Entrega | Aceite principal |
|---|---|---|
| **12b** (G-01) | `PATCH` de funcionário/filial/cargo com `registration_number`, `esocial_category_code`, `cnae`, `esocial_establishment_code`, `cbo_code` (**só formato**); `POST/DELETE /esocial/employees/:id/confirm-vinculo` | e2e de tenant A × B ⇒ 404; formato inválido ⇒ 400; confirmar sem `{"confirmo": true}` ⇒ 400; autor e hora gravados |
| **12c** (G-04) | Exames (`aso_exam_details`), upload do PDF do ASO, médicos (listar, editar, desativar), motivo do admin (`?reason=` ≥ 10 caracteres) | RLS por rota; admin sem motivo ⇒ 400; sem CPF sem redação em log |
| **16** | Diagnóstico com `key` estável por pendência; checa certificado válido (E-05), vínculo confirmado, campos do S-2220 | `ready=false` ⇒ 400 com a lista e **nenhuma** linha criada |
| **18a** (G-02, G-03) | `POST /esocial/events`, `/authorize`, `/retry`, `GET`; máquina de estados corrigida (`rascunho` **fora** do cron) | **Teste de segurança:** rascunho + cron ⇒ nada assinado nem transmitido; `authorize` em `producao` ⇒ 409; idempotência |

### Fase V — Verificação contra o oficial (humana, com apoio do Claude em leitura)

| Task | Entrega |
|---|---|
| **V1** | Baixar do gov.br o **pacote vigente** (XSD S-1.3 da NT 07/2026 e posteriores, MOS consolidada, WSDL), guardar **fora do repositório** com data e hash |
| **V2** | **Diff dos XSD** oficiais × os 52 do TST; relatório das divergências (campos, obrigatoriedades, `TS_cnpj`, `TS_Id`, namespace/versão do `evtMonit`) |
| **V3** | Conferir na MOS: regras do S-2220, prazo, grupos de evento, limite de lote (50?) |
| **V4** | Conferir WSDL, SOAPAction, **URLs de Produção real** e a cadeia de certificados do servidor |
| **V5** | **Licença:** checar `LICENSE.md` e eventuais licenças por arquivo; criar `THIRD_PARTY_NOTICES.md` para tudo que for copiado (ex.: `monit.json`) |

Saída da fase V: tabela do spec (seção 3) atualizada, trocando **EVIDÊNCIA SECUNDÁRIA FORTE** por **VERIFICADO** onde o oficial confirmar.

### Fase B — Transmissão em NestJS (referência: spec seção 10)

| Task | Entrega | Referência TST | Aceite |
|---|---|---|---|
| **13'** | Tipos TS do S-2220 **gerados do XSD oficial** (V1/V2) e `s2220-event-builder` a partir de `aso_records` + vínculo | `Monit.java`, `MonitMapper`, `evtMonit.xsd` | Builder gera o payload do `monit.json` adaptado; campos obrigatórios do XSD cobertos |
| **14'** | Gerador de XML na **ordem do XSD**, `Id` de 36 caracteres (`ID` + tipo de inscrição + CNPJ + data/hora + sequência), `indRetif` 1/2 | `GeradorXmlMonit`, `GeradorXmlMonitTest` | **XML válido contra o XSD oficial**; `indRetif=1` normal e `=2` com recibo |
| **15'** | Assinatura com `xml-crypto`: `rsa-sha256`, digest `sha256`, `enveloped-signature` + C14N 1.0, `Reference URI=""`, X509 no `KeyInfo`, **sem prefixo `ds:`** | `AssinaturaXmlServico` | Assina e **verifica** (ida e volta) com certificado de teste gerado; forma conforme a tabela do spec; a chave privada nunca persiste |
| **17'** | Lote **por grupo de evento** com `ideEmpregador` + `ideTransmissor`; SOAP com SOAPAction; **mTLS com `https.Agent` verificando hostname e cadeia**; timeouts | `GeradorLote`, `ComunicacaoEsocialGov`, `ComunicacaoParametros`, WSDL | **Teste que reprova se o hostname não for verificado**; lote de 1 a 50 eventos; URLs lidas de `esocial_layout_versions` (Produção real = `NULL`) |
| **18'** | Cron só de `aguardando_transmissao`…`processando`; **falha de um evento não derruba o ciclo**; máximo de tentativas; histórico com o **autor da autorização** | `EnvioServico`, `MaquinaEstadoLote`, `ConsultaLote` | Teste: um evento com erro não impede os demais; tentativas limitadas; chamada direta registrada em `ALLOWED` **depois de revisão** |
| **19'** | `GET /esocial/status` com RLS: certificado e eventos, sem XML assinado na listagem | `RetornoLote` | e2e cross-tenant ⇒ 404 |
| **20'** | Página `/empresa/esocial` (não `(app)/esocial`): Certificado, **Pendências de dados**, Eventos (criar, autorizar, histórico) | — | Verificação no navegador (desktop e mobile) |

### Tasks novas reveladas pelo TST

| Task | Entrega | Quando |
|---|---|---|
| **N1** | `esocial_layout_versions`: colunas para SOAPAction (envio/consulta), namespace do evento e versão do pacote de XSD | junto da 14'/17' |
| **N2** | **`ideTransmissor`** (`tpInsc`, `nrInsc`): hoje o transmissor é o próprio empregador (certificado do cliente). Modelar para o Sub-projeto 2 (procuração, Montese como transmissora) **sem implementá-lo agora** | desenho na 17' |
| **N3** | Teste de **hostname verificado** e âncoras de confiança do servidor do governo | 17' |
| **N4** | Retificação (`indRetif=2` + `nrRecibo`) e S-3000: as colunas existem; **fora do Sub-projeto 1** | depois |

### Fase C

| Task | Entrega |
|---|---|
| **21** | Suíte completa em **ensaio descartável** (receita em `reference_ensaio_descartavel_isolado`); sweep de isolamento |
| **22** | `PRODUCT.md` atualizado **só depois** da 23 |
| **23** | Validação manual em **Produção Restrita** com certificado A1 de teste e credenciamento (não automatizável); registrar códigos reais de erro como base da Central de rejeições |

## 5. Decisões abertas que ainda bloqueiam (do desenho G-01..G-04, seção 9.2)

1. Destino da migration `0063` do PDF (numeração).
2. Chave mestra `ESOCIAL_CERT_ENCRYPTION_KEY`: obrigatória × opcional.
3. Retenção (`CASCADE` × `RESTRICT`) e prazo de purga do `.pfx`.
4. **Quem baixa e lê as tabelas oficiais** (categorias, CBO, CNAE) para a validação definitiva. **A fase V responde parte disso.**
5. Prioridade do eSocial frente aos releases do shell/admin e da NR.

## 6. Estimativa e risco

**Sem prazo confiável (NÃO VERIFICADO).** Redução de risco esperada: o formato do XML, a assinatura, o envelope e os limites deixam de ser INFERIDOS (passam a ter evidência e,
depois da fase V, verificação). Riscos que **permanecem**: NT 07/2026 posterior ao XSD do TST; WSDL real vs. cliente SOAP; certificado A1 de teste e credenciamento (Task 23);
validação jurídica de LGPD para o ASO.

---

## Apêndice — N8 · CNPJ alfanumérico (tarefa separada, prioridade sua)

**Problema (VERIFICADO no código do Montese e no XSD):**

- O XSD do evento define o CNPJ como `[A-Z0-9]{12}\d{2}` (14 caracteres, **alfanumérico**). O TST já o suporta desde 2026-07-02.
- O Montese **normaliza o CNPJ removendo tudo que não é dígito** (`onlyDigits` em `backend/src/common/validators/cnpj.util.ts`), valida só o módulo 11 **numérico** (`isValidCnpj`) e a coluna é `tenants.cnpj VARCHAR(14) NOT NULL UNIQUE`.
  Um CNPJ alfanumérico seria **mutilado** (as letras somem) e **rejeitado** no cadastro (`register.dto.ts`).
- Alcance **além do eSocial:** cadastro, `company_units`, onboarding (`MatrizForm`), PDFs/relatórios que formatam CNPJ, e qualquer máscara ou comparação por dígitos. O comprimento (14) cabe na coluna atual.

**O que o fix toca (estimativa, NÃO implementado):** normalização (maiúsculas, remover pontuação, manter letras), validação do dígito verificador alfanumérico, máscara e entrada no frontend,
testes (numérico legado **continua válido**), conferência das telas e documentos que exibem CNPJ.

**Pendências antes de implementar:** (a) a **regra oficial do dígito verificador alfanumérico** e a vigência: **INFERIDO/NÃO VERIFICADO**, conferir no documento oficial da Receita Federal;
(b) quantos CNPJs alfanuméricos já podem existir entre os clientes; (c) prioridade e janela (não depende do eSocial).
