# Análise: TST (`tst-labs/esocial`) como microserviço de transmissão do eSocial

Data: 2026-10-05. Somente análise; nenhum código alterado. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 0. Fontes oficiais (VERIFICADO: baixadas e lidas em 2026-10-05)

Origem: `https://www.gov.br/esocial/pt-br/documentacao-tecnica`

| Fonte | Versão |
|---|---|
| Esquemas XSD S-1.3 (até NT 07/2026 rev.) `2026-11-23_esquemas_xsd_v_s_01_03_00-1.zip` | produção em 23/11/2026 |
| MOS S-1.3 consolidada até NO 11/2026 (426 págs.) | publicada 26/05/2026, retificada 28/05/2026 |
| Manual de Orientação do Desenvolvedor | v1.16 |
| Pacote de Comunicação | v1.6 |
| Mensagens do Sistema | v2.5 (abril/2026) |

Limites: o PDF da NT 07/2026 em si não foi lido; do MOS foram lidos só os trechos de S-2210, S-2220, S-2240 e S-3000. A identidade byte a byte entre a pasta local do proprietário e o zip baixado é NÃO VERIFICADA.

## 1. Veredito (RECOMENDADO)

Não usar o TST como serviço pronto. Usá-lo como oráculo e fonte de portagem; implementar o serviço isolado de transmissão em NestJS.

1. Um empregador e um A1 por instalação (`esocialjt.cnpj-empregador`, `arquivoCertificado`); nenhuma migration do TST tem tenant (VERIFICADO).
2. Desliga a verificação de hostname do TLS: `ComunicacaoConfig.java:65` (VERIFICADO).
3. Java 8 / Spring Boot 2.6.1; README declara API "instável"; sem validação semântica (VERIFICADO).
4. Alternativa (INFERIDO): README, configuração 3, permite TST sem certificado delegando assinar/enviar/consultar a uma API REST externa.

## 2. Comparação TST × oficial × Montese

| Tema | Oficial | TST | Montese |
|---|---|---|---|
| Assinatura | RSA-SHA256, digest SHA-256, enveloped + C14N, EndCertOnly | igual | não iniciada (Task 15) |
| Transporte | SOAP 1.1 doc/literal, TLS 1.2 mútuo, 4 cifras GCM | SOAP + mTLS, sem hostname | não iniciada (Task 17) |
| Lote | ≤50 eventos, mesmo empregador e grupo, SOAP ≤750 KB | por grupo | não iniciada |
| Retorno | 101, 201, 202 (advertências), 301, 401 | estados; 202 tratado como sucesso | só colunas |
| Consulta | resultado disponível 30 dias | existe | não iniciada |
| WSDL/XSD de lote | pacote v1.6 | idêntico (7 arquivos) | não iniciada |

- URL de envio (produção): `https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc`; produção restrita: `https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc`. Produção real continua `NULL` no banco até liberação do proprietário.
- `EnviarLoteEventos` não exige vínculo formal (procuração) entre transmissor e empregador; `ideTransmissor` deve coincidir com o certificado da conexão TLS. Cada evento é assinado com e-CPF/e-CNPJ.

## 3. S-2210, S-2220, S-2240, S-3000

Os XSD dos 4 eventos no TST são idênticos ao oficial de 23/11/2026 (VERIFICADO). `tipos.xsd` difere, mas sem tipos usados por esses eventos. Vinte outros XSD de evento do TST estão defasados (S-2200, S-2299, S-1000 etc.; irrelevantes para o Montese).

| Evento | TST já tem | Reutilizável | Desatualizado | A desenvolver |
|---|---|---|---|---|
| S-2220 | XSD, JAXB, mapper, gerador, regra, teste | XSD, `monit.json`, teste | nada | montar dados de ASO/PCMSO; Tabela 27; `respMonit`; `indResult` só com autorização do trabalhador |
| S-2210 | idem (`CatMapper`, `GeradorXmlCat`) | XSD, `cat.json` | nada | módulo de CAT inexistente |
| S-2240 | idem (`ExpRiscoMapper`, `RegraExpRisco`) | XSD, teste | nada | inventário de risco estruturado inexistente |
| S-3000 | idem (`ExclusaoMapper`, `ExclusaoServico`) | XSD, lógica | nada | `nrRecEvt` do evento original; regras de exclusão do MOS |

Prazos citados do MOS: S-2220 até dia 15 do mês seguinte à emissão do ASO (admissional: do mês seguinte à admissão); S-2210 até o primeiro dia útil seguinte ao acidente (óbito: imediato); S-2240 até dia 15 do mês seguinte ao início da obrigatoriedade/admissão ou à alteração; S-3000 sempre que necessário. Pré-requisito de S-2210/2220/2240: S-2190, S-2200 ou S-2300.

## 4. Arquitetura recomendada

Montese (NestJS, RLS) mantém empresas/trabalhadores/vínculos, ASO/PCMSO, regras SST, diagnóstico, autorização humana (ator + hora) e `esocial_events` + histórico append-only. Serviço isolado `esocial-tx` recebe XML do evento + referência de tenant + chave de idempotência e executa: validar XSD → assinar A1 (só em memória) → montar lote → SOAP/mTLS (hostname e cadeia ICP-Brasil verificados) → consultar lote → devolver recibo/código/advertências. O serviço não conhece regras SST e o Montese não transmite sem autorização humana gravada.

## 5. Componentes reutilizáveis (BSD-3)

XSD e exemplos JSON como material de teste (preferir o XSD oficial direto); pacote de comunicação (usar o oficial); lógica de transporte, assinatura e máquinas de estado (portar a lógica); testes de gerador como roteiro (sem golden files completos). Fixtures copiados: atribuição em THIRD_PARTY_NOTICES.

## 6. Incompatibilidades

Um empregador/A1 por instalação × multi-tenant; hostname sem verificação; banco próprio sem `tenant_id`/RLS; Java 8 e A1 em arquivo; 20 XSD defasados; sem validação semântica nem regras SST; CNPJ alfanumérico quebrado no Montese (N8). Qual das classes `SecurityConfig`/`SecurityConfigDisable` vale por padrão: NÃO VERIFICADO.

## 7. Tarefas da auditoria

Reduzidas/substituídas: 13 (parte "verificar XSD" resolvida), 14 (roteiro), 15 (parâmetros confirmados), 17 (WSDL/URLs confirmados), V1, V3 e parte de V2.
Continuam: 5, 6, 10–12 e achados E-01 a E-19; G-01 a G-04; 16, 18, 19, 20, 21, 22, 23; N8; E-04 e E-05 mais críticos.

## 8. Riscos

Alto: reaproveitar o TST sem corrigir hostname/multi-tenant; S-2210/S-2240 sem dado de origem; dado de saúde e LGPD sem validação jurídica; transmitir em produção real por engano (E-13); cron sem autorização humana (G-03).
Médio: resultado do lote some em 30 dias; XSD mudam por pacote (26/10, 23/11, 14/12/2026, 18/01/2027); semântica só validada em Produção Restrita; prazos calculados errado.
Baixo: atribuição BSD-3 e uso do nome do TST.

## 9. Plano em ordem (nada executado)

1. Decisões do proprietário: serviço NestJS isolado; modelo do certificado (A1 do cliente × transmissor próprio); 0063, chave mestra e retenção.
2. A1 de teste e inscrição em Produção Restrita; validação jurídica da LGPD do ASO.
3. Reconciliar a frente do eSocial com a `main` (E-01, E-03, E-04 a E-10, E-19).
4. N8 (CNPJ alfanumérico).
5. Versionar os XSD oficiais com teste de regressão por pacote.
6. G-01 e G-04.
7. Tasks 13 e 14 para S-2220.
8. Task 15 (assinatura).
9. Task 17 (SOAP/mTLS, só Produção Restrita).
10. G-02, G-03 e Task 16.
11. Task 18 (estados 101/201/202/301/401, gravar retorno antes dos 30 dias).
12. Tasks 19 e 20.
13. Task 23 (validação manual).
14. S-3000; depois S-2210 e S-2240 quando houver CAT e inventário de risco.
15. Produção real só com autorização do proprietário.
