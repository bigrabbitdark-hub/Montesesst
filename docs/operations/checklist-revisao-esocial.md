# Checklist de revisão — entregas do eSocial SST (feitas por Cline/MiniMax)

> **Uso:** aplicar sobre o que o outro fluxo (Cline + MiniMax) entregar, antes de qualquer merge, release ou commit na
> `main`. **Só leitura**: o revisor não edita a worktree do executor. Fontes: `docs/specs/esocial-seguranca.md`,
> `esocial-arquitetura.md`, `esocial-mapeamento-dados.md`, plano `2026-09-29-esocial-sst-subprojeto1.md` (Global
> Constraints), `AGENTS.md` e `2026-10-04-esocial-reconciliacao-com-main.md`.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Um item sem evidência é **NÃO VERIFICADO**.

## 0. O que o executor deve entregar para ser revisável

- Branch + intervalo de commits (`git log --oneline <base>..HEAD`) e a **base** usada (SHA).
- Relatório por task (padrão `task-N-report.md`): arquivos, desvios do brief justificados, saída real dos testes.
- Saída de `tsc --noEmit`, `nest build` e das suítes rodadas (unit e e2e no container descartável), colada, não resumida.
- Lista de **variáveis de ambiente novas** e de qualquer mudança em Docker/compose/Nginx (que exigem autorização — AGENTS.md).
- Nada de `git push`, `reset`, `revert`, reescrita de histórico, `docker compose down -v` (AGENTS.md).

## 1. Bloqueadores (P0) — qualquer "não" reprova a entrega

| # | Verificação | Como conferir |
|---|---|---|
| 1 | **Nenhum segredo em código, log, teste, fixture ou resposta de API** (senha de certificado, chave privada, chave mestra, `.pfx` real) | `git diff <base>..HEAD \| grep -niE "password\|senha\|BEGIN (RSA\|PRIVATE\|ENCRYPTED)\|\.pfx\|\.p12\|[0-9a-f]{64}"` e leitura de cada ocorrência. Fixtures devem ser certificado **de teste gerado**, com senha de teste óbvia |
| 2 | **Toda tabela com `tenant_id`**: `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy padrão de 3 ramos | ler cada migration; rodar `tenant-isolation-sweep.e2e-spec.ts`; conferir no banco de ensaio `relrowsecurity`/`relforcerowsecurity` |
| 3 | **Tenant nunca vem do cliente**: sempre `req.withTenantContext(...)`, nunca de `dto/body/query/params` | `grep -rn "withTenantContext" backend/src/esocial backend/src/aso`; qualquer `db.withTenantContext` fora de `req.` deve estar na lista `ALLOWED` de `tenant-context-callsites.unit-spec.ts` |
| 4 | **Acesso cruzado devolve 404, não 403**, e há teste ativo de tenant A × B para certificado, evento e ASO | specs `*-rls.e2e-spec.ts` dedicados |
| 5 | **Histórico append-only**: `REVOKE UPDATE, DELETE, TRUNCATE` em `esocial_event_history` para `montese_app` | no banco de ensaio: `has_table_privilege` / `information_schema.role_table_grants` |
| 6 | **Build limpo**: `nest build` compila `backend/test` inteiro; spec com erro de tipo quebra a imagem (precedente `69f8c43`; hoje `esocial-events-rls.e2e-spec.ts` tem 3 erros TS) | `npx tsc --noEmit` e `npx nest build` com exit 0 |
| 7 | **Migrations**: numeração livre (sem colidir com a `main`), ordem de FKs preservada, aditivas, **nada destrutivo**, aplicadas de verdade em banco de ensaio — nunca em produção | `ls backend/db/migrations \| sort -V`; conferir contra a `main` atual |
| 8 | **Boot em produção**: `ESOCIAL_CERT_ENCRYPTION_KEY` entra no fail-fast (spec §2) → o backend não sobe sem ela. Há plano para criar a chave no `.env` **antes** do release? (precedente: Google, 2026-09-30) | `env.validator.ts` + teste de boot isolado com o `.env` real |
| 9 | **Transmissão só após o Diagnóstico eSocial**; assinatura roda no backend, como o usuário autenticado; **certificado nunca no frontend** | ler `transmission-queue.cron` e os controllers; spec §9 |
| 10 | **Sem produção real**: URLs/ambiente de Produção Restrita; nada que envie evento ao eSocial real de verdade sem autorização expressa | ler o cliente SOAP e as constantes de URL |

## 2. Certificado digital e criptografia (spec §1)

- Envelope encryption: data key de 32 bytes por certificado; AES-256-GCM; **IV novo por operação**; authTag guardado.
- Chave mestra só em variável de ambiente (64 hex, rejeitar placeholder); sem fallback hardcoded.
- `.pfx` cifrado vai para o R2, **nunca** em disco da VPS nem blob em coluna; chave privada em PEM **nunca persiste**.
- Decifra em memória e só no momento de assinar/transmitir; sem cache da senha ou do PEM.
- `toSummary()`/DTOs de resposta expõem só metadados (id, titular, validade, thumbprint, status) — nunca campo cifrado nem `r2_key`.
- Validação: `parsePkcs12` rejeita inválido, expirado (`notAfter`) e uso não permitido; mensagens de erro não vazam a senha.
- Tamanho máximo de upload e tipo tratados (sem confiar só em `Content-Type`).
- **Decisões do proprietário em aberto** (não aprovar por omissão): chave obrigatória × opcional, retenção/exclusão física do
  certificado removido (hoje soft-delete), LGPD do material cifrado.

## 3. Permissões e auditoria (spec §3 e §5)

- `@Roles` conforme a matriz do spec §3 (`empresa`, `tecnico` vinculado, `admin` com motivo registrado). Testar o **POST/DELETE
  como admin**: `tenant_id` nulo pode falhar (concern aberto da Task 12; o e2e atual não cobre).
- `uploaded_by_user_id` e demais autores vêm de `req.user`, nunca do DTO.
- `audit_log` captura as mutações via interceptor existente; `esocial_event_history` registra criador, validador, assinante,
  mudanças de estado, protocolo e erro. **Certificado e senha nunca aparecem em nenhuma das duas trilhas.**

## 4. Logs e dado de saúde (spec §6 e §7)

- Nenhum `console.log`; o logger não imprime payload XML completo em INFO, nem CPF sem redação (`pii-redaction.util.ts`),
  nem certificado/senha; erros SOAP logam só código/status HTTP.
- ASO é **dado de saúde sensível (LGPD)**: resultado/exames restritos a `empresa` dona + `tecnico` vinculado + `admin` com motivo;
  nunca em relatório agregado sem anonimização; nada de dado de saúde enviado a IA sem minimização (AGENTS.md).
- Retenção do XML/histórico é proposta **sujeita a validação jurídica** — não tratar como decidida.

## 5. XML, assinatura e SOAP (Tasks 13–19)

- Itens marcados INFERIDO no spec (estrutura exata do XSD, algoritmo de assinatura, URLs) só viram constante **depois** do passo
  de verificação contra a fonte oficial; conferir que o passo foi feito e registrado, não presumido.
- XML validado contra o XSD oficial da versão ativa (`esocial_layout_versions`); assinatura XMLDSig verificada em teste.
- mTLS com `https.Agent` nativo; certificado carregado só em memória; timeout e retry limitados; sem loop infinito no cron.
- Máquina de estados do cron: transições válidas, idempotência (não reenviar evento já aceito), erro não derruba o processo.
- Vínculo do trabalhador no eSocial **nunca presumido** (spec §9): exige confirmação registrada.

## 6. Testes e qualidade

- Suítes novas cobrem o caminho feliz **e** o de erro (certificado inválido, expirado, senha errada, tenant cruzado, evento sem
  diagnóstico). Teste que só confere string de SQL não prova o DDL — exigir execução em banco de ensaio.
- e2e roda no container descartável da rede `montese_internal`, **nunca contra dados reais**; cancelar um run no meio deixa
  fixtures no Postgres real — conferir resíduo em `tenants`/`users`.
- Falhas pré-existentes conhecidas (3 suítes unit: `question-notices`, `normative-answer-shared`, `r2-get-object`) não contam
  como regressão; qualquer falha **nova** reprova.
- Sem `any` escondendo erro de tipo, sem `@ts-ignore`, sem teste desabilitado/`skip` para "passar".

## 7. Escopo e limites do executor (AGENTS.md)

- Sem alterar provider/modelo de IA, Docker, Nginx, TLS, DNS, backups, secrets ou produção sem autorização.
- Sem criar role de banco nem exigir superuser fora do ensaio (precedente: Task 1 bloqueada pelo classificador).
- Sem duplicar funcionalidade existente (reusar `R2Service`, `secret-crypto.util.ts`, `pii-redaction.util.ts`, `AuditInterceptor`).
- Sem commit na `main`, sem `push`; commits só na branch de trabalho e só o que o plano pede.

## 8. Veredito (preencher na revisão)

| Resultado | Critério |
|---|---|
| **Aprovado** | todos os P0 verificados com evidência; nenhum achado Important aberto |
| **Aprovado com ressalvas** | P0 ok; achados menores registrados com dono e prazo |
| **Reprovado** | qualquer P0 sem evidência ou com falha; segredo exposto; RLS ausente; build quebrado |

Registrar por achado: arquivo:linha, evidência (comando e saída), severidade, correção sugerida.
