# eSocial SST (sub-projeto 1) — plano de reconciliação com a main

> **Status: PROPOSTA — nada executado.** Só documento. Cada passo que mexe em código, branch ou produção exige OK do
> proprietário (AGENTS.md). Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: revisão de 2026-10-04 da worktree `.claude/worktrees/esocial-sst-subprojeto1` (branch
> `worktree-esocial-sst-subprojeto1`). Plano original: `2026-09-29-esocial-sst-subprojeto1.md`.

## 1. Estado (VERIFICADO em 2026-10-04)

- Tasks 1–11 commitadas (13 commits à frente da base antiga; 34 atrás da `main`). Task 12 (`CertificatesController` +
  e2e de RLS) **pronta, não commitada** (`task-12-report.md`; 5 arquivos). Tasks 13–23 **não iniciadas**.
- Entregue: 5 migrations, criptografia AES-256-GCM com envelope por certificado, parsing PKCS#12, módulo ASO,
  `CertificatesService`/Controller. **Não existe** geração, assinatura nem transmissão de eventos S-2220.

## 2. Bloqueios de integração

| # | Bloqueio | Evidência | Efeito se ignorado |
|---|---|---|---|
| B1 | **Numeração de migrations colide** | worktree: `0061_esocial_layout_versions` … `0065_esocial_prerequisite_columns`; main: `0061_openrouter_credit_status`, `0062_minimax_usage_estimated_cost` (já em produção), `0063_sst_audit_document_facts` (não commitada), `0064_company_applicable_nrs` | `db:migrate` aplica por ordem de nome: dois arquivos 0061/0062/0063/0064 = schema divergente ou migration pulada |
| B2 | **`ESOCIAL_CERT_ENCRYPTION_KEY` entra no fail-fast** | `common/config/env.validator.ts:29` (exige 64 hex) | backend não sobe em produção sem a chave (mesmo padrão do incidente do Google em 2026-09-30) |
| B3 | **`esocial-events-rls.e2e-spec.ts` não compila** | `task-12-report.md`: 3 erros TS (`insertRawRow`, `getActiveLayoutVersionId`, `token`). Sem `tsconfig.build.json` nem `include`, o `nest build` compila `backend/test` (precedente: `69f8c43`) | **`nest build` quebra** ao integrar → imagem não builda |
| B4 | Base defasada | 34 commits atrás da `main`; baseada antes de 0057–0064 | conflitos em `app.module.ts`, `db-test-helper.ts`, `env.validator.ts` (INFERIDO) |

## 3. Decisões do proprietário (antes de qualquer código)

1. **Destino da `0063` do PDF** (hoje não commitada): define a próxima numeração livre. Se ficar, o eSocial começa na `0065`.
2. **Chave `ESOCIAL_CERT_ENCRYPTION_KEY`:** (A) **opcional** — ausente = módulo desativado, 503 claro (padrão aplicado ao Google
   Calendar, `0b2fe82`; RECOMENDADO enquanto não há transmissão), ou (B) **obrigatória** — o proprietário gera 32 bytes hex
   (`openssl rand -hex 32`), guarda fora do repositório e do histórico. Perder a chave = certificados cifrados irrecuperáveis.
   Eu não gero nem exibo segredos.
3. **Política de retenção/exclusão do certificado:** hoje `remove` é soft-delete (`status='removido'`) e o material cifrado
   permanece. Definir prazo e exclusão física (LGPD).
4. **Modelo de produto** (técnico autônomo × empresa + médico PCMSO): conflito aberto da "Grande Evolução".
5. **Prioridade:** eSocial antes ou depois do release do shell/lotes e da conformidade por NR.

## 4. Passos propostos (cada um com OK)

1. Commitar a Task 12 na worktree (proprietário autoriza; mensagem sugerida no report).
2. Criar branch de integração a partir da base escolhida (não mexer na worktree original).
3. **Renumerar** (a partir da próxima livre, mantendo a ordem de FKs: layouts → certificados → ASO → eventos → colunas):

   | Atual | Novo (se 0063 do PDF permanece) |
   |---|---|
   | 0061_esocial_layout_versions | 0065 |
   | 0062_esocial_certificates | 0066 |
   | 0063_aso_module | 0067 |
   | 0064_esocial_events | 0068 |
   | 0065_esocial_prerequisite_columns | 0069 |

   Atualizar referências em testes, comentários, plano, ledger e specs (`grep` pelos nomes antigos).
4. **Neutralizar B3:** completar os helpers (`insertRawRow`, `getActiveLayoutVersionId`, `token`) **ou** mover o spec
   para fora de `backend/test` até a task que o destrava. Conferir `tsc --noEmit` e `nest build` limpos.
5. Aplicar a decisão da chave (B2): se opcional, o `CertificateCryptoService`/módulo degrada com erro claro e há teste de boot sem a chave.
6. Testar o caso `admin` no POST/DELETE de certificados (concern registrado: `tenant_id` nulo; o e2e atual não cobre).
7. **Ensaio em clone do banco** (padrão de `release-backend-2026-09-30.md`): aplicar as 5 migrations em ordem, rodar suítes
   eSocial/ASO/RLS no container descartável, boot isolado com o `.env` real **sem** a chave.
8. Só então planejar release (backup → migrations → backend). Sem frontend nesta etapa (a Task 20 ainda não existe).

## 5. Fora deste plano

Tasks 13–23 (XSD, S-2220, XML, XMLDSig, SOAP, fila/cron, status, tela, `PRODUCT.md`) e a validação em Produção
Restrita (Task 23: exige certificado A1 real e ambiente do governo — não automatizável). Retomar só depois dos passos 1–7.
