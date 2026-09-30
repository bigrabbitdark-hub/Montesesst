# Spec: Segurança do módulo eSocial (Sub-projeto 1)

Complementa `esocial-arquitetura.md` e `esocial-mapeamento-dados.md`.

## 1. Certificado digital — armazenamento

Fluxo: upload (.pfx/.p12 + senha) → validação estrutural PKCS#12 (`node-forge`) →
extração de metadados (titular, CPF/CNPJ, validade, thumbprint, uso permitido) →
**envelope encryption** → armazenamento.

Envelope encryption (mesmo padrão já usado no projeto para o refresh token do Google,
`backend/src/common/crypto/secret-crypto.util.ts`, AES-256-GCM):

1. Gera uma **data key** aleatória (32 bytes) por certificado.
2. Cifra o arquivo `.pfx` bruto e a senha do certificado com a data key (AES-256-GCM, IV
   novo por operação).
3. Cifra a data key com a **chave mestra** (nova variável de ambiente
   `ESOCIAL_CERT_ENCRYPTION_KEY`, 32 bytes hex, mesmo padrão fail-fast de
   `env.validator.ts`: obrigatória em produção, formato validado, rejeitada se for
   placeholder).
4. Armazena: `.pfx` cifrado no bucket R2 (mesmo padrão de todo outro arquivo do
   sistema — nunca em disco da VPS, nunca em coluna de banco como blob grande), data key
   cifrada + IV + authTag em coluna de `esocial_certificates`.
5. Decifra em memória, sob demanda, só no momento de assinar/transmitir — nunca persiste
   a chave privada em PEM em disco ou banco.

**Migração futura para KMS real** (AWS KMS/Vault, fora de escopo desta fase): troca-se
apenas quem cifra a data key (passo 3) por uma chamada ao KMS — os dados já cifrados
(passo 2) não precisam ser recifrados, porque a data key continua sendo a mesma, só muda
quem a protege.

**Nunca**: senha em texto puro em qualquer lugar (banco, log, resposta de API, cache),
chave privada em PEM persistida fora de memória de processo, certificado de um tenant
acessível por outro tenant sob nenhuma circunstância.

## 2. Secrets e variáveis de ambiente

Segue o padrão já estabelecido: `ESOCIAL_CERT_ENCRYPTION_KEY` entra em `.env.example`
(documentada), em `REQUIRED` de `backend/src/common/config/env.validator.ts` (fail-fast
em produção, formato de 64 hex = 32 bytes, rejeitada se for valor de exemplo), repassada
via `docker-compose.yml`. Nenhum secret do eSocial (senha de certificado, chave privada)
nasce ou termina em `.env` — só a chave mestra que protege o envelope nasce lá.

## 3. Permissões

Mapeadas para os 4 roles existentes (`empresa`, `tecnico`, `parceiro`, `admin` —
`backend/src/common/types.ts`). O prompt original pedia 4 níveis incluindo "usuário
comum"; **esse nível não existe hoje como role separada no sistema** (cada tenant tem
login único de `empresa`, sem sub-usuários) — mapeado como observação, não inventado.

| Ação | `empresa` (dono do tenant) | `tecnico` vinculado | `admin` Montese |
|---|---|---|---|
| Cadastrar certificado | Sim | Não | Sim (com motivo registrado em auditoria) |
| Substituir certificado | Sim | Não | Sim |
| Validar certificado | Sim | Sim (leitura + ação de validar) | Sim |
| Remover certificado | Sim | Não | Sim |
| Visualizar metadados (nunca a senha, nunca a chave) | Sim | Sim | Sim |
| Transmitir evento | Sim | Sim (se vinculado ao tenant) | Sim |

Aplicado via `@Roles(...)` (guard já existente, `RolesGuard`) + RLS (mesmo padrão de 3
ramos: admin vê tudo, dono do tenant, técnico vinculado via
`assigned_tenant_ids_for_current_user()`). Nenhuma rota do eSocial confia em `tenantId`
vindo do corpo da requisição — sempre `req.withTenantContext(...)`, igual a todo o
resto do sistema (regra testada estaticamente por
`tenant-context-callsites.unit-spec.ts`).

## 4. Multi-tenancy

Toda tabela nova (`esocial_certificates`, `esocial_events`, `esocial_event_history`,
`aso_records`, `aso_exam_details`, `tenant_pcmso_physicians`) nasce com `tenant_id NOT
NULL`, `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, policy padrão do
projeto. `esocial_layout_versions` é a única tabela global (sem `tenant_id`) — mesma
categoria de `caepi_records`, dado de referência compartilhado, não dado de tenant.

Pega automaticamente pelo `tenant-isolation-sweep.e2e-spec.ts` (varredura por catálogo,
falha se alguma tabela com `tenant_id` não tiver FORCE RLS). Complementado por um
`esocial-certificates-rls.e2e-spec.ts` e `esocial-events-rls.e2e-spec.ts` dedicados,
seguindo o padrão manual já usado nos ≥24 arquivos `*-rls.e2e-spec.ts` existentes,
testando acesso cruzado ativo e esperando 404 (não 403) para não vazar a existência do
recurso.

## 5. Auditoria

Duas camadas, reaproveitando a infraestrutura existente:

- **`audit_log`** (mutações HTTP, já existente): captura automaticamente
  criar/atualizar/remover certificado e criar/transmitir evento via
  `AuditInterceptor` (mesmo interceptor global, mesmo formato, sem código novo).
- **`esocial_event_history`** (nova, específica de domínio): trilha completa por evento
  — quem criou, quem validou, quem assinou (a operação de assinar sempre roda como o
  usuário autenticado que disparou a transmissão, nunca como processo anônimo), quando
  cada estado mudou, resultado, protocolo, erro. Append-only via `REVOKE UPDATE, DELETE`
  na role `montese_app`, mesmo mecanismo que já protege `audit_log`.

Certificado e senha **nunca** aparecem em nenhuma das duas trilhas — só metadados
(id do certificado, thumbprint, titular), nunca o conteúdo.

## 6. Logs

Segue o padrão já estabelecido no módulo `normative` (`redactPii()`,
`query-trace.ts` — nunca loga texto de pergunta/resposta, só ids/hashes/contagens):

- `esocial-soap-client.service.ts` nunca loga o payload XML completo em nível INFO —
  só metadados (tipo de evento, tenant_id, resultado, duração). Payload completo só em
  nível DEBUG local, nunca em produção, e mesmo assim com CPF redigido.
- CPF do trabalhador nunca aparece em log sem redação (reaproveita
  `backend/src/common/text/pii-redaction.util.ts`, já usado no assistente).
- Erro de comunicação SOAP loga código/status HTTP, nunca o certificado ou a senha
  usados na conexão mTLS.

## 7. Dado de saúde (LGPD)

O ASO é **dado de saúde do trabalhador**, categoria sensível sob a LGPD (art. 5º, II).
Isso é uma observação de arquitetura, não uma definição jurídica — a Montese já tem
princípio de minimização de PII para IA (AGENTS.md, seção "IA"), mas retenção e
minimização de dado de saúde no contexto eSocial (por quanto tempo manter XML/histórico
de ASO, quem pode acessar resultado de exame vs. só o fato de "ASO em dia") **precisam
de validação jurídica/compliance formal antes de produção real** — não é decisão que
este documento resolve sozinho. Proposta inicial conservadora até essa validação: acesso
a `aso_records.result`/exames complementares restrito a `empresa` dona + `tecnico`
vinculado + `admin` com motivo registrado (mesmo padrão de permissão de certificado,
seção 3), nunca exposto em relatório agregado sem anonimização.

## 8. Retenção

Proposta inicial (sujeita à validação jurídica da seção 7): XML gerado/assinado,
protocolo, recibo e histórico de evento retidos indefinidamente (é a evidência legal de
cumprimento da obrigação — descartar cedo demais é pior do que guardar). Certificado
expirado/substituído: metadados retidos para auditoria, blob PFX cifrado pode ser
purgado do R2 após período de retenção a definir (não antes de confirmação jurídica).

## 9. O que NÃO fazer (reforço explícito das regras do AGENTS.md aplicadas a este módulo)

Nunca: certificado no frontend (toda operação de assinatura roda no backend), senha em
texto em qualquer camada, senha em log, transmissão sem passar pelo Diagnóstico eSocial,
acesso cross-tenant a certificado/evento/XML de outro tenant, presumir que o vínculo do
trabalhador já existe no eSocial sem confirmação explícita registrada.
