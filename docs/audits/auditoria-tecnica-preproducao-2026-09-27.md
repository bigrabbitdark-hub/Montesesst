# Auditoria Técnica Pré-Produção — Montese SST (2026-09-27)

**Metodologia:** análise estática somente-leitura, executada por 8 agentes independentes em paralelo (multi-tenancy/RLS, segurança, agentes de IA/RAG, avaliação de autoria/qualidade do código recente, banco de dados/migrations, pagamentos/Mercado Pago, documentos/onboarding, infraestrutura/testes/legado), mais verificação direta de uma auditoria de segurança anterior (`docs/audits/security-audit-preprod.md`, 22/09/2026). Nenhum arquivo de código foi modificado durante esta auditoria. Não houve acesso a um Postgres vivo nem a um navegador real — tudo aqui é leitura de código-fonte, migrations e histórico git. Onde isso limita a certeza, está marcado como NÃO COMPROVADO.

**Rótulos usados:** VERIFICADO (lido/confirmado diretamente) · NÃO VERIFICADO / NÃO COMPROVADO (não foi possível confirmar) · INFERIDO (dedução lógica razoável, sem execução) · RECOMENDADO.

---

## 1. Status geral do projeto

**Estado atual: SÓLIDO NA ARQUITETURA CENTRAL, COM PENDÊNCIAS REAIS NÃO BLOQUEADORAS.**

O achado mais importante desta auditoria é também o mais tranquilizador: **nenhum dos 8 agentes, incluindo um agente dedicado exclusivamente a isolamento multi-tenant e RAG, encontrou vazamento cross-tenant real ou provável (P0)**. Isso é notável para um SaaS B2B multi-tenant com RLS em 48 tabelas. Ao mesmo tempo, a auditoria encontrou **7 achados P1** (backup sem cópia externa, `.env.bak` fora do `.gitignore`, cancelamento de assinatura sem efeito de bloqueio, PII enviada sem minimização à IA externa, upload sem antivírus combinado com validação de MIME fraca, e dois problemas reais de indexação de banco) que precisam ser resolvidos antes ou logo no lançamento, e uma quantidade grande de achados P2/P3/P4 de maturidade operacional.

Um achado colateral relevante: o próprio prompt desta auditoria presumia que o trabalho recente foi produzido por "Cline usando MiniMax como modelo". A evidência de git **não sustenta essa atribuição específica** — ver seção 11.

---

## 2. Percentual estimado de prontidão por área

*(Estimativa própria, INFERIDA a partir das evidências dos 8 agentes — não é uma métrica calculada por ferramenta.)*

| Área | Prontidão | Justificativa resumida |
|---|---|---|
| Infraestrutura | 80% | Rede isolada corretamente, restart policy em todos os serviços, TLS/headers OK. Faltam healthchecks em redis/backend/frontend/nginx e cópia externa de backup. |
| Segurança | 85% | Todos os P0 da auditoria de 22/09 confirmados corrigidos. Achados novos são P1/P2/P3, nenhum crítico ativo. |
| Banco de dados | 80% | Schema disciplinado, 100% aditivo, RLS exemplar. Indexação real da tabela `documents` e busca CAEPI são pontos fracos concretos. |
| Multi-tenancy | 90% | Nenhum vazamento encontrado, incluindo teste específico de RAG. Ponto fraco é arquitetural (dependência única da RLS sem redundância de aplicação), não um bug ativo. |
| Cadastro/Onboarding | 70% | Fluxo funciona e é validado (CNPJ real, duplicidade por constraint). Tem um beco-sem-saída real (sem reenvio de confirmação de e-mail) e navegação sem gating. |
| Frontend | 70% | Bons estados vazio/erro na maioria dos painéis; dashboard da empresa engole erros silenciosamente; sem guard de role client-side. |
| Backend | 80% | Arquitetura em camadas respeitada, DI consistente; um bypass histórico de RLS já ocorreu (corrigido no mesmo dia) e o hardening de segurança P0 não veio com teste. |
| Agentes de IA | 65% | 3 agentes reais e funcionais, guardas anti-alucinação sólidas; gap real de minimização de PII antes de enviar a provedores externos; sem teto de custo em produção. |
| RAG | 75% | Pipeline completo e funcional (empresa: automático; normas: aprovação humana); isolamento cross-tenant verificado seguro; sem OCR para PDF escaneado. |
| Documentos | 70% | Isolamento/sanitização de path/limite de tamanho corretos; MIME só por Content-Type + zero antivírus é o ponto fraco real. |
| Pagamentos | 55% | Webhook/HMAC/idempotência excelentes; mas cancelamento não revoga nada hoje — é o achado de maior risco de negócio de toda a auditoria. |
| Integrações | 75% | MiniMax/OpenRouter/R2/Google Calendar/Resend individualmente robustos; acoplamento MiniMax+OpenRouter é ponto único de falha do RAG. |
| Testes | 75% | 160 arquivos de teste, isolamento de tenant testado de forma rigorosa (não superficial). P0 de segurança foi commitado sem teste. |
| Observabilidade | 70% | Logs estruturados e auditoria sólidos; falta custo de IA em moeda por tenant e alerta ativo de erro 5xx/rate-limit além do log. |
| Produção | 65% | A maior parte da infra está pronta; backup sem cópia externa e algumas lacunas de documentação de config (`.env.example`) são as pendências reais. |

---

## 3. O que já funciona (VERIFICADO)

- Isolamento multi-tenant via RLS: 48/48 tabelas com RLS também têm FORCE RLS; nenhuma policy permissiva (`USING(true)`) em SELECT; funções auxiliares sempre derivam do usuário autenticado, nunca de parâmetro externo, e falham fechado.
- Isolamento cross-tenant do RAG de documentos da empresa: dupla camada (validação de vínculo técnico↔empresa na aplicação + RLS forçada de 4 branches no banco).
- Os 3 P0 e os P1 (F-15, F-19, F-20, F-21, F-22, F-27, F-26) da auditoria de segurança de 22/09 — reconfirmados presentes no código atual, não apenas alegados.
- Autorização de rotas administrativas: todas as rotas de `/admin/*` exigem `@Roles('admin')`, guard global aplicado corretamente.
- bcrypt cost factor 12, centralizado, testado (F-24 do backlog anterior já foi corrigido silenciosamente).
- Webhook do Mercado Pago: HMAC com `timingSafeEqual`, nunca confia no corpo, sempre busca estado real na API, idempotência real testada em e2e.
- Guardas anti-alucinação do Assistente: `tool_choice` forçado, verificador de IDs de citação, e verificador que confere se o número de NR/artigo citado aparece literalmente no texto da fonte.
- Distinção "não encontrei" vs "não existe" corretamente implementada e documentada.
- Sanitização de nome de arquivo e isolamento de chave R2 por tenant — sem risco real de path traversal.
- Testes de isolamento de tenant (24 arquivos `*-rls.e2e-spec.ts`) são rigorosos: testam ativamente acesso cruzado e verificam 404 (não 403, evitando vazar existência do recurso).
- Backup diário do Postgres com cron real confirmado e retenção de 14 dias (mesmo com a limitação da seção 5 abaixo).
- Auditoria (`audit_log`) é append-only por REVOKE de privilégio SQL, não só por RLS.
- CNPJ validado com dígito verificador real (não é regex de formato); duplicidade de CNPJ/e-mail garantida por constraint de banco.

## 4. O que funciona parcialmente (com evidência)

- **Enforcement de plano pago**: limite de funcionários é real e aplicado no backend; documentos/armazenamento/nº de usuários não têm nenhum enforcement (consistente com decisão de produto documentada, mas é "parcial" na prática).
- **Classificação automática de documento**: existe e funciona, mas é só sugestão opcional numa rota separada — a categoria real sempre exige confirmação humana.
- **Alertas de vencimento**: existem e são calculados corretamente (tempo real no dashboard + e-mail semanal), mas o e-mail só roda 1x/semana sem escalonamento por prioridade.
- **Ata-IA (CIPA)**: código completo e exposto na UI, mas dormente por falta de `GROQ_API_KEY`.
- **Onboarding**: o passo obrigatório (dados da matriz) funciona bem; os passos opcionais (filiais/funcionários/documentos) funcionam, mas o estado do wizard não persiste a um F5 e a navegação lateral não tem nenhum gating.
- **Env.validator.ts (fail-fast em produção)**: cobre os 6 secrets mais críticos, mas não cobre `DATABASE_URL`, `REDIS_URL`, `MERCADOPAGO_ACCESS_TOKEN`, nem as credenciais do R2.

## 5. O que não funciona (com evidência)

- **Bloqueio de acesso após cancelamento/inadimplência de assinatura**: `getActiveEmployeeLimit` retorna `null` quando não há assinatura `authorized`, e o código trata `null` exatamente como "trial nunca bloqueado". Cancelar remove o único controle existente, em vez de aplicar um.
- **Recuperação de senha ("esqueci minha senha")**: não existe nenhuma rota para isso em todo o backend.
- **Reenvio de e-mail de confirmação de cadastro**: não existe. Um usuário que perde o link de 48h fica em um beco sem saída (recadastro esbarra em 409 de duplicidade).
- **Backup externo do Postgres**: nunca foi implementado — o script de backup não tem nenhuma linha de upload para R2/S3, apesar das credenciais R2 já estarem preenchidas hoje.
- **Antivírus/varredura de malware em upload**: não existe em nenhum ponto do pipeline.
- **OCR de PDF escaneado**: não existe — documento sem camada de texto nunca vira embedding/texto pesquisável.

## 6. O que não foi possível comprovar

- Se o Docker daemon volta a subir sozinho após reinício completo do servidor (depende de configuração de `systemd` no host, fora do escopo de leitura de código).
- Eficácia real do verificador de alucinação contra prazo/penalidade (só números com unidade, que hoje são apenas logados, não bloqueados) — exigiria rodar o dataset golden (`backend/eval/`), o que não foi feito.
- Comportamento real sob concorrência de webhooks duplicados chegando simultaneamente.
- Se o valor real de `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_PROD_*` em uso é de produção ou de sandbox (só nomes de variável foram inspecionados, nunca valores).
- Validação de formato de CEP/UF/telefone e dígito verificador de CPF no backend (não explorado em profundidade).
- SPF/DKIM do domínio de envio de e-mail (Resend) — não auditável por leitura de código.
- Qualquer teste de penetração real (upload de arquivo malicioso de fato, tentativa de acesso cross-tenant via token forjado) — auditoria 100% estática.
- Se existe algum mecanismo operacional fora do código de aplicação para reenviar e-mail de confirmação manualmente.
- **Atribuição de autoria do trabalho recente a "Cline+MiniMax"** — ver seção 11, é o achado metodológico mais importante desta categoria.

---

## 7. Problemas críticos (P1 — resolver antes do lançamento)

1. `.env.bak.20260925-213951UTC` na raiz do projeto não está coberto por nenhuma regra do `.gitignore` — um `git add -A` o commitaria permanentemente.
2. Cancelamento/inadimplência de assinatura não revoga nenhum acesso no backend hoje.
3. Texto bruto de PGR/PCMSO/LTCAT/LIP (pode conter nome + dado de saúde) é enviado sem minimização a provedores externos de IA (embedding incondicional no upload + prompt do assistente); mesma lacuna na transcrição de reunião de CIPA.
4. Upload de documento valida MIME só por `Content-Type` declarado pelo cliente (sem magic bytes) e não há nenhuma varredura de antivírus — combinação que permite armazenar e distribuir arquivo malicioso para outros usuários do mesmo tenant.
5. A tabela `documents` (a mais usada do sistema) nunca teve nenhum índice em 52 migrations — sequential scan em toda listagem/verificação de vencimento.
6. Busca de CAEPI usa `ILIKE` em 4 colunas de texto sem índice trigram/GIN contra uma tabela nacional potencialmente enorme — já lento hoje, independente do número de tenants.
7. Backup do Postgres continua só no disco local da mesma VPS, sem cópia externa, apesar das credenciais R2 já estarem preenchidas.

## 8. Problemas importantes (P2 — resolver antes ou logo após lançamento controlado)

8. Dezenas de rotas aceitam `tenant_id` do body/query e dependem 100% da RLS como única barreira, sem validação de aplicação redundante — e já houve um caso real (histórico) de bypass nesse exato padrão (ver seção 11).
9. A tabela `tenants` é a única das 58 tabelas sem RLS própria — depende inteiramente da aplicação resolver `tenantId` do JWT.
10. `env.validator.ts` não cobre `DATABASE_URL`, `REDIS_URL`, `MERCADOPAGO_ACCESS_TOKEN` nem as credenciais R2 (mesmo padrão de risco que já motivou a correção de F-21/F-26).
11. Troca de plano (upgrade/downgrade) pode gerar duas cobranças recorrentes simultâneas no Mercado Pago (assinatura antiga nunca é cancelada automaticamente).
12. `.env.example` não documenta nenhuma variável `MERCADOPAGO_*` nem `R2_ENDPOINT`, apesar de serem credenciais reais em uso.
13. MiniMax (resposta) e OpenRouter (embedding) estão acoplados no mesmo fluxo — sem crédito OpenRouter, o RAG inteiro falha mesmo com MiniMax saudável.
14. Sem teto de custo monetário de IA em produção, por tenant ou geral (só existe para o script interno de avaliação).
15. Extração/embedding de documento roda de forma síncrona dentro do request HTTP (até 240s), sem fila/worker — risco de degradar a responsividade do Node sob carga.
16. Dashboard da empresa (`empresa/dashboard/page.tsx`) engole erros de fetch silenciosamente (`.catch(() => {})`) — falha de rede aparece como "sem dados" em vez de erro.
17. Layouts `admin`/`empresa`/`tecnico` no frontend não fazem nenhuma checagem de role antes de renderizar a casca de navegação (dados reais continuam protegidos pelo backend, mas cria falsa sensação de acesso).
18. Único alerta proativo de vencimento roda semanalmente sem escalonamento por prioridade — item de prioridade alta pode ficar até 6 dias sem e-mail.
19. `DELETE` físico de `company_unit` faz CASCADE sobre atas de CIPA, eleições, treinamentos de brigada e simulados de emergência — sem soft-delete.
20. Várias tabelas tenant-scoped anteriores à "Fase 25" não têm índice em `tenant_id` (o padrão só amadureceu a partir da migration 0042).
21. 3 das 12 funções `SECURITY DEFINER` (as de auto-registro) não receberam o hardening `SET search_path` já aplicado às demais.
22. Ausência de fluxo de recuperação de senha.
23. Ausência de reenvio de e-mail de confirmação de cadastro (beco sem saída real para quem perde o link).
24. `PRODUCT.md` afirma que não há IA em produção — falso, existem 3 agentes reais e ativos; risco de comunicação externa incorreta se esse documento alimentar marketing/onboarding.
25. O commit de hardening de segurança P0 (F-15/19/20/21) não trouxe nenhum teste automatizado — validação ficou só narrativa.

## 9. Melhorias não bloqueadoras (P3/P4 — backlog)

26. Sem dedup de documento por hash (custo de armazenamento cresce a cada reenvio idêntico).
27. `credentials: true` no CORS é desnecessário (sistema não usa cookies em lugar nenhum).
28. Mensagens de erro genéricas em duplicidade de CNPJ/e-mail e em `MatrizForm`/`FiliaisForm` (não repassam a mensagem específica do backend).
29. Sem teste e2e para reenvio duplicado do evento `subscription_preapproval` via HTTP.
30. Sem cron de reconciliação entre banco e Mercado Pago (confia 100% em entrega de webhook).
31. Downgrade de plano não trata retroativamente funcionários acima do novo limite (grandfathering implícito, não documentado).
32. Falha de upload no R2 não gera mensagem amigável ao usuário (só 500 genérico).
33. Falha de integração com Google Calendar é 100% silenciosa para o usuário (nunca bloqueia a visita, mas também nunca avisa pra reconectar a conta).
34. Ausência de healthcheck em redis/backend/frontend/nginx no docker-compose (só postgres tem).
35. Rota pública `GET /tenants/:id/logo` permite enumerar UUIDs de tenant existentes.
36. Botão de apagar documento fica oculto na UI para admin mesmo quando o backend permite (mismatch de UX, não de segurança).
37. Ícones sociais decorativos (`href="#"`) no rodapé do site público.
38. Inconsistência de categorias de documento entre DTO/service/schema (documentada como intencional, vale nota para manutenção futura).
39. Rota de download de documento sem `@Roles()` explícito (mitigado pela RLS, mas recomendável por defesa em profundidade).

---

## 10. Auditoria dos agentes de IA

**Existem 3 agentes reais e ativos, mais 1 dormente:**

| Agente | Provider ativo | Status |
|---|---|---|
| Assistente Normativo RAG | MiniMax-M3 (resposta) + OpenRouter (embedding) | Ativo, com 27+ chamadas reais registradas até 20/09/2026 |
| Copiloto de extração de checklist de inspeção | OpenRouter (Claude Sonnet 5) | Ativo |
| Ata-IA (transcrição de reunião de CIPA) | Groq Whisper + OpenRouter | Construído e exposto na UI, mas **dormente** por falta de `GROQ_API_KEY` |

**O que fazem de verdade:** o Assistente responde só via tool call forçado (`answer_with_citations`), nunca em texto livre; todo `chunk_id`/citação é validado contra o conjunto real de fontes passadas ao modelo; claims que citam número de NR/artigo são descartadas se o texto da fonte não confirmar literalmente. A distinção "não encontrei" vs "não existe" é regra fixa documentada e implementada (`FALLBACK_MESSAGE`). O copiloto de checklist extrai 16 itens fixos de um relato de técnico, proibido opinar ou inventar item.

**O que não fazem:** não há minimização de PII antes de enviar documento/transcrição a provedores externos (achado P1, seção 7); não há teto de custo monetário em produção; não há validação formal (só empírica) do threshold de similaridade do RAG; prazo/penalidade citados não são bloqueados por regex dedicado (só números com unidade, e isso é apenas logado).

**Riscos:** acoplamento MiniMax+OpenRouter (ponto único de falha), PII sem minimização (risco técnico de LGPD), Ata-IA "fantasma" na UI.

**Qualidade do RAG:** pipeline completo e funcional nos dois fluxos (normas oficiais com aprovação humana obrigatória; documentos da empresa com indexação automática). Isolamento cross-tenant verificado seguro com dupla camada.

**Observabilidade:** boa quanto a auditoria de uso (retenção 90 dias, RLS), fraca quanto a custo em moeda (não há coluna de custo estimado em nenhuma tabela de log).

---

## 11. Auditoria MiniMax/Cline

### Correção metodológica necessária (leia antes da nota)

O prompt desta auditoria presumiu que o desenvolvimento recente foi feito por "Cline usando MiniMax como modelo de raciocínio", com base na observação de que 333 dos 576 commits do repositório são "cline checkpoint" concentrados em 22-26/09/2026. **Essa premissa não se sustenta**: verificação direta (`git merge-base --is-ancestor`) confirma que esses commits de checkpoint estão em refs separadas (`refs/cline/checkpoints/...`) e **nunca foram mergeados em `main`** — provam apenas que a extensão Cline esteve aberta no editor nesse período, não que os commits reais do projeto vieram dela. Mais decisivo: **todos os 576 commits em `main` têm trailer de coautoria, e a esmagadora maioria diz "Claude Sonnet 5"/"Claude Opus 5"/"Claude Haiku 4.5"** — zero commits nomeiam Cline ou MiniMax como ferramenta de codificação. "MiniMax"/"OpenRouter" aparecem no histórico apenas como *provedores de IA que o próprio produto Montese usa*, nunca como a ferramenta que escreveu o código.

**Conclusão: NÃO COMPROVADO que Cline+MiniMax produziu o código deste repositório.** A evidência de metadado disponível aponta majoritariamente para Claude Code. Se o objetivo real é avaliar especificamente uma sessão de Cline+MiniMax, isso exigiria cruzar com logs do próprio Cline/VS Code (fora do git), o que está fora do escopo desta auditoria.

Dito isso, a avaliação de qualidade do trabalho em si — que é real e verificável independentemente de qual ferramenta o produziu — segue abaixo.

### O que foi construído na janela de maior atividade (22-26/09/2026, 36 commits reais confirmados)

Framework de avaliação do Assistente (dataset golden, métricas, camadas A/B), hardening de segurança P0 completo (F-15/19/20/21/22/27), painel "Visão Geral" do admin, Fase 10 do Assistente (retrieval, claim-support, RAG compartilhado, guarda de role), diversos fixes de contraste/acessibilidade e de regras de negócio.

### Achado central: bypass de RLS multi-tenant já ocorrido no histórico do projeto

Commit `9af00d1` (11/09/2026) corrigiu um IDOR real em `PenteFinoComparisonService.run`: o contexto de tenant para RLS era montado a partir do `tenant_id` do **corpo da requisição** em vez do JWT autenticado — um técnico sem vínculo podia informar o UUID de qualquer empresa e receber PGR/PCMSO completo dela. O bug foi introduzido no mesmo dia (commit `96d3e97`, mesma feature) e corrigido também no mesmo dia, com teste RED→GREEN e contraprova positiva. Isso é evidência concreta — não hipotética — de que a arquitetura "RLS como única barreira" (achado P2 #8 desta auditoria) já falhou uma vez na prática, ainda que capturada rapidamente.

Achado adicional: o fallback `JWT_SECRET || 'dev-secret-change-me'` ficou hardcoded desde o commit fundador do projeto (17/08/2026) até ser corrigido em 23/09/2026 — **cerca de 37 dias**, toda a vida do projeto até então.

### Nota técnica por categoria (0-10)

| Categoria | Nota | Justificativa |
|---|---|---|
| Arquitetura | 7 | Padrões (DI, Strategy para providers de IA, RLS compartilhada) bem aplicados; lapso grave na primeira versão de uma feature nova. |
| Qualidade do código | 6,5 | Comentários explicam o "porquê"; proporção alta de commits corretivos indica primeira implementação frequentemente incompleta. |
| Segurança | 5 | Bypass de RLS crítico + secret hardcoded por ~37 dias são achados sérios, ainda que corrigidos. |
| Testes | 6 | 160 specs, RLS testada rigorosamente; mas o próprio hardening de segurança P0 não veio com teste. |
| Banco/RLS | 7 | FORCE RLS consistente e bem desenhado; RLS sozinha não protege contra erro de aplicação — foi exatamente o que aconteceu. |
| Multi-tenancy | 5 | Categoria mais penalizada pelo bypass histórico, mesmo corrigido no mesmo dia. |
| Integrações | 7 | Fallback de provider de IA via DI bem desenhado; ativação em produção sem validação real de chamada de API é risco assumido. |
| Agentes/IA | 6 | Framework de avaliação maduro; PII sem minimização; provider ativado sem teste de API real. |
| Tratamento de erros | 7 | Fallback local de rate-limit testado, fail-fast de OAuth testado. |
| Manutenibilidade | 7 | Documentação por fase consistente, commits rastreáveis. |
| Prontidão para produção | 5 | Hardening recente sem teste automatizado; bypass histórico real; PII sem minimização. |

### Veredito: AMARELO

Não é possível emitir veredito específico para "Cline+MiniMax" pela razão exposta acima. Para o **padrão de trabalho observado neste repositório, independente da ferramenta exata**: **AMARELO — pode continuar operando, mas com revisão humana obrigatória em qualquer mudança que toque `TenantContext`/RLS/autenticação/secrets**, e com exigência de teste automatizado no mesmo commit para qualquer mudança classificada como "P0 de segurança". Justificativa: o processo de autocorreção é real e visível (padrão RED→GREEN, alta proporção de commits corretivos), mas um bypass crítico de multi-tenancy passou pela primeira implementação de uma feature nova sem ser pego antes do commit, e um fallback de secret sobreviveu ~37 dias sem auditoria dedicada.

---

## 12. Auditoria do pagamento (Mercado Pago)

**"Se o usuário pagar, o sistema libera exatamente o que deveria?"** Parcialmente. O único gate real de funcionalidade paga é o limite de funcionários (backend-enforced, testado). `tenants.plan` é atualizado corretamente no pagamento aprovado, mas só é usado para exibição em telas de admin — nada mais no sistema (documentos, upload, inspeções, EPI, assistente) verifica plano ou status de assinatura.

**"Se cancelar, o acesso muda corretamente?"** **Não.** Cancelamento remove o único controle existente (o limite de funcionários passa a ser tratado como "trial ilimitado"), em vez de bloquear algo. `auth.service.ts` só verifica `users.status`, nunca status de assinatura, no login.

**Pontos fortes verificados:** assinatura HMAC correta com `timingSafeEqual`; webhook nunca confia no corpo, sempre busca estado real via API; idempotência real (`UNIQUE` + `ON CONFLICT DO UPDATE`) com teste e2e cobrindo reenvio de invoice; RLS forçada em `subscriptions`/`payment_events` com testes dedicados; histórico mostra um bug real de vazamento de role admin já corrigido (migration 0016).

**Lacunas:** upgrade/downgrade pode gerar cobrança dupla (assinatura antiga não é cancelada automaticamente); `.env.example` não documenta nenhuma variável `MERCADOPAGO_*` (existem 7 reais no `.env`, incluindo 4 `_PROD_*` nunca lidas em código); sem reconciliação periódica banco↔Mercado Pago (confia 100% em webhook).

---

## 13. Auditoria do cadastro (onboarding)

Fluxo mapeado por leitura de código (sem navegador real): cadastro → confirmação de e-mail (JWT, 48h) → login (redirect por role) → onboarding (matriz obrigatória; filiais/funcionários/documentos opcionais) → dashboard. CNPJ validado com dígito verificador real; senha só valida tamanho (8-72 caracteres), sem exigência de complexidade; duplicidade de CNPJ/e-mail garantida por constraint de banco com mensagem genérica ("Registro duplicado", não diz qual campo).

**Um cliente novo consegue entrar sozinho e concluir o cadastro sem quebrar o sistema?** Sim, no caminho feliz. Mas há um beco sem saída real: **não existe reenvio de e-mail de confirmação** — se o link de 48h expira ou se perde, recadastrar-se esbarra em 409 (registro pendente já existe), sem rota de recuperação visível no código.

O wizard de onboarding não persiste o passo atual (F5 sempre volta para o passo 2, ainda que os dados já salvos não se percam) e a navegação lateral não verifica se o onboarding foi completado — um usuário pode ignorá-lo inteiramente e usar o resto do sistema com dados de empresa vazios.

---

## 14. Auditoria de segurança

Todos os P0/P1 da auditoria anterior (F-15, F-19, F-20, F-21, F-22, F-26, F-27) foram reconfirmados corrigidos no código atual, não apenas alegados em documentação. Achados novos desta rodada: arquivo `.env.bak` fora do `.gitignore` (P1); `env.validator.ts` não cobre `DATABASE_URL`/`REDIS_URL`/`MERCADOPAGO_ACCESS_TOKEN`/credenciais R2 (P2); MIME de upload validado só por `Content-Type` sem antivírus (P1, combinado); `credentials: true` desnecessário no CORS (P3, sem uso de cookies em lugar nenhum, então CSRF clássico não se aplica); ausência de fluxo de recuperação de senha; 3 de 12 funções `SECURITY DEFINER` sem hardening de `search_path`. Nenhum stack trace vazado, zero `console.log`/`TODO`/`FIXME`/secret hardcoded novo encontrado no código atual.

---

## 15. Auditoria multi-tenant (prioridade máxima)

**Resultado: nenhum vazamento cross-tenant real ou provável encontrado.** 48/48 tabelas com RLS habilitada também têm FORCE RLS (a role da aplicação é dona das tabelas e não tem BYPASSRLS — isso torna FORCE crítico, não cosmético, e está 100% consistente). Nenhuma policy permissiva em SELECT. O teste específico pedido pelo dono do produto — RAG de documentos entre empresas — foi verificado seguro com dupla camada de proteção (validação de vínculo na aplicação + RLS forçada com 4 branches no banco). O achado F-11 da auditoria anterior (upload cross-tenant) foi re-verificado de forma independente e confirmado correto.

O ponto de atenção não é um bug ativo, é arquitetural: dezenas de rotas aceitam `tenant_id` do body/query e dependem 100% da RLS como única barreira, sem validação de aplicação redundante. Isso funciona hoje porque a RLS está bem implementada, mas é um ponto único de falha — e **já houve um caso real** desse exato padrão falhando (o bypass de `pente-fino`, seção 11), corrigido no mesmo dia em que foi introduzido. A tabela `tenants` é a única exceção entre 58 tabelas sem RLS própria.

---

## 16. Auditoria de produção

Falta, para produção real:
1. Resolver os 7 P1 da seção 7 (nenhum é grande esforço individualmente — a maioria é de baixo custo de implementação).
2. Cópia externa de backup do Postgres (credenciais R2 já existem, só falta a lógica de upload no script).
3. Completar a cobertura de `env.validator.ts` (adicionar `DATABASE_URL`, `REDIS_URL`, `MERCADOPAGO_ACCESS_TOKEN`, credenciais R2).
4. Decidir e documentar a política de bloqueio de acesso por assinatura cancelada/inadimplente antes do primeiro cliente pago real.
5. Atualizar `PRODUCT.md` para refletir a existência real dos agentes de IA (risco de comunicação externa incorreta se usado em marketing).
6. Adicionar `.env.bak*` ao `.gitignore` e decidir o destino do arquivo `.env.bak.20260925-213951UTC` existente.

---

## 17. Checklist final para produção (itens numerados)

### Registro de execução (2026-09-28) — só o que foi verificado, e como

Nada abaixo foi commitado nem implantado; o código está na árvore de trabalho. As migrations 0053/0054 e a extensão `pg_trgm` já estão aplicadas no Postgres de produção. **Em 2026-09-28 14:13 (com autorização sua, backup novo `montese-20260928-141237.dump` local + R2 antes) foram aplicadas também a 0055, a 0058 e a 0059** — `docker cp` dos 3 arquivos + `npm run db:migrate`; **0056, 0057 e 0060 NÃO foram aplicadas**. Verificado no banco de produção depois: as 3 registradas em `_migrations`; 13 funções `SECURITY DEFINER`, todas com `pg_temp` explícito (antes: 3 sem `SET` e 7 só com `public`); os 21 índices da 0059 existem; `auth_reset_password` com dono, `search_path` e grants corretos; FORCE RLS continua em 48 tabelas; a função `auth_find_user_by_email` (alterada pela 0055) executa sob a role da aplicação. Containers no ar e sem erros nos 6 minutos seguintes — **sem nenhuma requisição nesse intervalo**, então não há prova com tráfego real. O código da aplicação em execução **não mudou**.

| Item | Estado | Verificação real | Não verificado / ressalvas |
|---|---|---|---|
| 001 | Concluído | `git check-ignore` casa a regra; arquivo movido para `/opt/montese-backups/env/` (700) | — |
| 002 | Backend concluído, **não implantado** | 10 testes e2e verdes (empresa/técnico/admin; cancelled/paused bloqueiam; trial/pending/authorized liberam; `/auth/me` e `POST /subscriptions` isentos). Em produção hoje 0 clientes seriam bloqueados (2 empresas com assinatura ativa/pendente, 0 técnicos) | **Lacuna do frontend tratada e VERIFICADA (backend no clone, aviso no navegador):** `GET /subscriptions/me` (isento do bloqueio) + `SubscriptionNotice` nos layouts empresa/técnico + estado "sem assinatura" no dashboard. `tsc --noEmit` do frontend passa, e o backend novo (`SubscriptionAccessService`, refatoração da guarda, `/subscriptions/me`) passa no spec estendido no clone (14:00 e 14:05); o aviso "Sua assinatura está inativa" e o link "Reativar meu plano" (empresa → `/planos`, técnico → `/tecnico/planos`) foram verificados no navegador com `/api` interceptado — **não** contra o backend real. `parceiro` fica isento por desenho |
| 003 | Implementado e verificado ponta a ponta | Unit: redação (14 casos) + indexador (XLSX e PDF). **e2e (`documents-pii-minimization.e2e-spec`, 2/2):** upload real de PGR pelo controller — nome de funcionário cadastrado e CPF não chegam ao `embed()` nem ao `company_document_chunks` (o que volta no prompt do Assistente), com o texto técnico preservado; e a lista de nomes consultada é a do próprio tenant (RLS), sem cruzar tenants | Cobre só CPF e nomes de funcionários cadastrados — **não remove RG, telefone, endereço nem dado de saúde em texto**. Documentos já indexados antes **não** são reprocessados. Nome hifenizado entre linhas escapa. O e2e usa R2 falso (o assunto é PII, não storage) |
| 004 | **Parcial por decisão do fundador (2026-09-28): antivírus adiado** | Validação de conteúdo real implementada em 6 pontos de entrada (ver detalhes abaixo). Unit: 21/21 (assinatura PDF/PNG/JPEG, entradas de DOCX/XLSX, zip bomb real, cabeçalho de ZIP que mente sobre o tamanho) | **Sem antivírus (ClamAV) — decisão consciente de adiar.** Assinatura correta não prova que o arquivo é inofensivo: um PDF válido pode carregar conteúdo ativo. Áudio da ata CIPA continua validado só pelo tipo declarado. Sem biblioteca nova (só 5 formatos). Achados extras corrigidos: `fire-safety-equipment/:id/foto` e `prevention-checklists/.../foto` **não validavam tipo nenhum**; o teto de 3 MB do XLSX de funcionários era só do tamanho comprimido (zip bomb passava). **Verificação e2e (contra S3 falso em memória, nunca o R2 de produção):** `upload-content-validation` 9/9 (HTML como PDF/PNG/JPEG, ZIP sem entradas de DOCX, zip bomb de 250 MB recusado em 3,5 s, `classify-batch` não chama a IA com PDF falso); caminho de sucesso com arquivos reais em `documents-upload`, `documents-partner`, `documents-download-delete`, `documents-technical-categories`, `documents-word-excel`, `cipa-trainings`, `fire-brigade`, `fire-safety-equipment`, `prevention-checklist` e `tenants-logo` — 53/54; a única falha (`GET /tenants/:id/logo … URL real do R2`) é artefato do harness (o teste espera o host do `R2_ENDPOINT` https real; o redirect em si funcionou). Fixtures de imagem falsa (`fake-image-bytes`, `fake png bytes`) trocados por PNG/JPEG reais em 4 specs, sem mudar nenhuma asserção |
| 005 | Concluído | Índices `documents_tenant_id_idx` e `documents_expires_at_idx` existem em `pg_indexes` | **Ganho não medido** (sem `EXPLAIN` antes/depois) |
| 006 | Concluído | 4 índices GIN trigram existem em `pg_indexes` | **Ganho não medido**; não confirmado que o planner os usa para `ILIKE '%q%'` |
| 007 | Concluído (com ressalvas de segurança) | Backup real enviado ao R2 e conferido (tamanho + MD5); cópia baixada do R2 `cmp` idêntica ao local; restaurada em banco temporário com contagens idênticas à produção (59 tabelas, 51 policies, 48 FORCE RLS, 135 índices, 31 tenants…); caminho de falha testado (backup local sai íntegro, script termina com código 1) | Mesmo bucket e mesmas credenciais da aplicação (invasão da VPS alcança os backups); sem criptografia do lado do cliente; bucket sem acesso público **não verificado**; sem alerta ativo; **1º disparo pelo cron das 03:00 ainda não observado**. Detalhes em `docs/operations/backups.md` |
| 010 | Concluído | Validador ampliado de 6 para 14 variáveis (`DATABASE_URL`, `REDIS_URL`, `MERCADOPAGO_ACCESS_TOKEN`, 4 do R2 e, depois, `PUBLIC_APP_URL` — ver "Risco novo" abaixo; a verificação abaixo contra o ambiente real foi feita com as 13 primeiras) e os placeholders `missing-*` dos serviços entram na lista de valores proibidos. 28 testes unitários (antes o validador não tinha nenhum). **A função real foi executada contra o ambiente real do container de produção: passa nas 13 regras**, então o próximo deploy não entra em loop de reinício por causa disto | Só protege com `NODE_ENV=production` (por desenho); o boot real do `main.ts` não foi executado |
| 021 | Migration 0055 escrita e **aplicada sem erro num clone do dump real**; **ainda NÃO aplicada em produção** | Estado em produção lido do banco: 3 funções sem nenhum `SET` e 7 só com `search_path=public` (o Postgres pesquisa `pg_temp` primeiro nesse caso) — mais do que a auditoria original apontava; só as 2 de pagamento estavam corretas. A migration padroniza as 10 restantes em `public, pg_temp` (precedente: migration 0017). **No clone, depois da migration: 13 funções `SECURITY DEFINER`, todas com `pg_temp` explícito, 0 sem `SET`, 0 só com `public`** | **Lacuna de cobertura — RESOLVIDA em 14:00:** o único teste que exercita `auth_confirm_email` (uma das 10 alteradas) — o de confirmação em `register.e2e-spec` e `register-technician.e2e-spec` — **falhou no clone** com `TypeError: Invalid URL` (nas duas fases, com e sem a 0057), antes de chegar na função. Causa **confirmada**: `PUBLIC_APP_URL` ausente no container de teste (o link do e-mail saía como `undefined/...`). Com a variável definida os dois specs passam nas duas fases, então `auth_confirm_email` sob a 0055 está coberta e verde. **APLICADA em produção em 2026-09-28 14:13** (backup prévio; ver acima) |
| 009 | **Preparado e em ensaio; NÃO aplicado em produção (mudança de policy — depende de autorização)** | Migrations `0056` (função `tenant_logo_file_key`, para a rota pública do logo) e `0057` (RLS + FORCE em `tenants`, policy: admin / próprio id / vinculados), código do logo atualizado, spec `tenants-rls.e2e-spec.ts` (11 casos: empresa A vs B, admin, técnico vinculado/sem vínculo, parceiro, sem contexto = vazio, INSERT direto negado, logo público) | **Ensaio no clone do dump real (VERIFICADO):** sem a 0057, `tenants-rls.e2e-spec` **falha do jeito esperado** — empresa A enxerga o tenant de B, `count(*)` devolve 33 (esperado 1), `UPDATE` no tenant alheio afeta 1 linha, `INSERT` direto passa, técnico sem vínculo enxerga tudo; com a 0057 aplicada (49 de 58 tabelas com FORCE RLS: as 48 anteriores + `tenants`) a suíte não está entre as falhas. O restante da suíte, com a 0057 ligada, tem 11 suítes falhando (26 testes) — **nenhuma envolve a tabela `tenants`** (classificação em "Ensaio completo no clone", abaixo), mas a comparação com a linha de base do HEAD **ainda não foi feita**. **Ordem de implantação obrigatória:** 0056 → código novo no ar → 0057. Ligar a RLS com a imagem antiga em produção derruba `GET /tenants/:id/logo` (sem contexto, a leitura direta passa a devolver 0 linhas) |
| 012 | Concluído | `.env.example` agora documenta todas as variáveis que o backend lê (lista gerada por diff código × exemplo): `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `R2_ENDPOINT`, limites de rate limit que faltavam. Registra que `MERCADOPAGO_PUBLIC_KEY` e as 4 `MERCADOPAGO_PROD_*` do `.env` real **não são lidas pelo código** (não existe alternância sandbox/produção por variável) | `docker-compose.yml` **não** foi alterado (regra de infra): as variáveis novas de rate limit de recuperação de senha funcionam pelos padrões do código; para ajustá-las precisam constar no `environment` do compose |
| 020 | Migration 0059 **aplicada sem erro no clone (os 21 comandos `CREATE INDEX IF NOT EXISTS` rodaram sem erro; a contagem de índices no catálogo **não foi conferida**)**; **APLICADA em produção em 2026-09-28 14:13 — os 21 índices existem (VERIFICADO no catálogo)** | Consulta ao catálogo em produção: **21 tabelas** com `tenant_id` sem índice que comece por ele (a auditoria listava 11; faltavam CIPA, brigada, simulados, checklists). Todas minúsculas hoje (dezenas de KB) — é problema de escala, não atual. `assistant_query_log` excluída de propósito | Ganho não medido |
| 022 | Implementado (backend + frontend); **e2e VERIFICADO no clone (21 casos); navegador VERIFICADO: 26/26 (Chromium, desktop e mobile)** | Migration 0058 (`auth_reset_password`, troca atômica por compare-and-swap no hash antigo), `POST /auth/forgot-password` e `/auth/reset-password`, token JWT de 1h no **fragmento** da URL, impressão digital HMAC do hash (o token morre quando a senha muda), resposta idêntica exista a conta ou não, aviso por e-mail após a troca, auditoria, rate limit. Páginas `/esqueci-senha` e `/redefinir-senha` (token removido da barra de endereço). Spec e2e `password-reset.e2e-spec.ts` com 20 casos | Sessões já abertas **não são revogadas** após a troca (JWT sem estado; valem até expirar, 8h). `auth_confirm_email` reativa qualquer usuário a partir do id (ver ITEM 042). **Navegador (Chromium, `next build` OK, `/api` interceptado — sem backend real): 26/26.** Cobre `/esqueci-senha` (envio com confirmação genérica, 429, rede caída, link a partir do login), `/redefinir-senha` sem token (link inválido + caminho para pedir outro), com token (**o token sai da barra de endereços e do histórico**), segundo link colado na mesma aba (só o fragmento muda), senhas diferentes (nada é enviado), sucesso (token e senha vão no **corpo**, nunca na URL), 400 "link inválido" e erro de validação do servidor; `noindex` e `no-referrer` no HTML; sem overflow horizontal e sem erros de console nas páginas novas, em 1280 e 390 px. **História:** a 1ª rodada deu 13/26 — todos os cenários com token falhavam porque o texto da regra de senha estava dentro do `<label>`, o nome acessível do campo não era "Nova senha" (o leitor de tela também leria a regra duas vezes); separei rótulo e descrição e passou. Uma falha remanescente era seletor do teste (o cabeçalho do site também tem um link "Entrar"). **Não coberto:** o e-mail de fato entregue pelo Resend (o e2e captura o e-mail com um fake) e a página conversando com o backend real (o navegador usou `/api` interceptado); a troca de senha contra o backend está coberta pelo e2e no clone. **A migration 0058 já está em produção (14:13), mas o código que a usa NÃO foi implantado** — a recuperação de senha ainda não existe para os usuários. `PUBLIC_APP_URL` está presente em produção (VERIFICADO) |
| 011 | Implementado; **e2e VERIFICADO no clone (10 casos); não aplicado em produção** | Migration 0060 (`payments_superseded_preapprovals`) + `SubscriptionsService.supersedePreviousAuthorized` chamado pelo webhook quando uma assinatura vira `authorized`: as OUTRAS `authorized` **criadas antes** do mesmo sujeito são canceladas no Mercado Pago e no banco (a mais nova vence); a antiga só sai depois da nova confirmada; idempotente; 4xx registra e segue, 5xx relança para o Mercado Pago reenviar. Spec `subscription-supersede.e2e-spec.ts` (10 casos) | **Defeito de projeto achado por revisão de leitura (não por teste) e corrigido antes de qualquer execução:** a primeira versão devolvia *todas* as outras `authorized`; com o webhook da nova e um aviso atrasado da antiga (ainda `authorized` no Mercado Pago) chegando quase juntos, cada uma cancelaria a outra e o cliente ficaria sem plano. O caso agora tem teste próprio (e a função é testada nas duas direções), **e os 10 casos passam no clone (14:00 e 14:05), contra um Mercado Pago falso**. Cancelamento com falha permanente deixa a antiga `authorized` até a reconciliação (ITEM 030). O webhook da antiga ainda regrava `tenants.plan` (campo só de exibição) com o plano antigo — comportamento anterior, não tratado. **Toca em cobrança real — precisa de aval antes de implantar** |
| 016 | Implementado; **VERIFICADO no navegador (Chromium, desktop)**; mobile em reverificação | `load()` do dashboard da empresa com 4 estados (carregando / ok / erro / sem-assinatura): 401 limpa a sessão e vai ao login; 403 `SUBSCRIPTION_INACTIVE` mostra o motivo; qualquer outra falha (500, rede) mostra alerta com "Tentar novamente"; falha só do `/tenants/me` não derruba o painel. `tsc --noEmit` e `next build` passam. **Navegador (`/api` interceptado, sem backend real):** painel normal aparece com o nome fantasia e o rodapé; 500 no resumo → alerta "Não foi possível carregar o painel agora." **sem** virar aviso de assinatura, e "Tentar novamente" recupera quando o mock passa a responder 200 (alerta some); requisição abortada (rede) → alerta + retry; 403 **sem** o código `SUBSCRIPTION_INACTIVE` → alerta genérico (não o de assinatura); 401 → `/login` com a sessão limpa; `/tenants/me` falhando com o resumo ok → painel com "sua empresa"; console sem erros relevantes | Só o dashboard da empresa foi tratado; outras telas com `.catch(() => {})` não foram varridas. No mobile (390 px) a página estoura na horizontal já no estado normal por causa da sidebar fixa — ver ITEM 047; o alerta e o aviso novos têm o seu encaixe testado à parte |
| 017 | Implementado; **VERIFICADO no navegador (Chromium)** | `RoleGuard` envolve o layout inteiro de admin/empresa/técnico: sem sessão, sessão vencida ou papel errado → nada da casca é renderizado e a pessoa vai para o login ou para a página do seu papel (`homeFor`). `tsc --noEmit` e `next build` passam. **Navegador, 16 cenários:** sem sessão nas 3 áreas → `/login`; papel errado (empresa→admin, técnico→empresa, admin→empresa, empresa→técnico, parceiro→admin, técnico→admin) → página do próprio papel **sem apagar a sessão**; token vencido, token malformado e `montese_user` corrompido → `/login` com a sessão limpa; `parceiro` em `/tecnico/*` fica (sem laço de redirecionamento); **controle positivo:** admin com sessão vê a casca ("Visão Geral"), então a ausência para deslogado é do guard. O HTML **renderizado** de `/admin/overview`, `/empresa/dashboard` e `/tecnico/empresas` traz só "Verificando acesso", sem menu, sem rodapé e sem o conteúdo da página; o payload RSC dentro dos `<script>` **não** contém texto da casca do admin (medido), então o comentário do componente é exato | **Só UX**: a autorização real continua no backend. O payload RSC das áreas empresa/técnico não foi inspecionado (só o do admin) |
| 008 | Implementado em duas frentes, **com prova de detecção**; **sem CI** (ITEM 044) | **(1) `tenant-isolation-sweep.e2e-spec` (10 casos):** descobre pelo catálogo todas as tabelas com `tenant_id` e, com a role da aplicação (somente leitura, `ROLLBACK`), exige: RLS ativa **e forçada** em todas; zero linhas de **outro** tenant sob o contexto de empresa de cada tenant que tem usuário `empresa` no clone (30 na rodada sabotada, dados reais incluídos); idem para técnico e parceiro vinculados e sem vínculo; sem contexto (falha fechada); e com role inventada. Clone limpo: **10/10 nas duas fases**. **Prova de detecção:** com 3 sabotagens deliberadas só no clone (FORCE desligado em `documents`, policy `USING (true)` em `company_units`, tabela nova com `tenant_id` e sem RLS) **8 dos 10 falham**, apontando as 3 tabelas (29, 5 e 3 linhas visíveis por tenant; 30 tenants afetados) só com contagens, sem conteúdo. **(2) `tenant-context-callsites.unit-spec` (12 casos, sem banco, ~5 s, roda no host):** lista as **23** chamadas `.withTenantContext(...)` em que o chamador escolhe o contexto — **todas revisadas à mão, cada arquivo com motivo por escrito** — e reprova contexto montado a partir de `dto/body/query/params` ou com a abreviação `tenantId`, em qualquer arquivo. Prova de detecção numa cópia do `src`: o bug histórico (`tenantId: dto.tenant_id`), a abreviação no `pente-fino` e uma chamada nova com variável são pegos; a cópia sem mutação passa. Comando único: `npm run test:isolation`. Suíte unitária inteira no host: 39 de 42 passam; as 3 falhas são as já conhecidas (ITEM 041 e `r2-get-object`, que sem R2 configurado falha por `Bucket` indefinido) | **Não cobre:** rota a rota (a varredura é por tabela); um alias (`const t = dto.tenant_id;`) escapa do heurístico (2). O item pedia "em CI" e **não existe CI** (ITEM 044): hoje só roda quando alguém executa. A varredura, se rodada contra o banco de produção (por desenho dos e2e), lê dados reais — só conta, nunca mostra. **Achado da revisão:** meu localizador inicial só via literais de objeto e deixava passar o `pente-fino` (usa a variável `ctx`) — corrigido; nos 23 pontos revisados **não achei vulnerabilidade** (observação P4: o callback público do Google segura a conexão do banco durante 2 chamadas HTTP ao Google; o `state` HMAC é verificado antes de qualquer uso do banco) |
| 023 | Implementado (backend + frontend); **e2e VERIFICADO no clone (11 casos) e navegador VERIFICADO (16/16); NÃO implantado** | `POST /auth/resend-confirmation`: público, resposta idêntica exista a conta ou não, envio sem aguardar (o tempo não denuncia), limite por IP+e-mail (3/h) **e** intervalo de 5 min por e-mail em qualquer IP (Redis, só o hash do e-mail na chave). **Só envia para conta `pendente`.** e2e no clone (`resend-confirmation.e2e-spec`, fases A e B, 47/47 junto de `register`, `register-technician`, `password-reset` e `auth`): o link novo **realmente ativa** a conta (login recusado antes, aceito depois); e-mail inexistente e conta ativa → mesma resposta e nenhum e-mail; intervalo; 400 para corpo inválido; 429; auditoria sem token. **Prova de detecção:** numa cópia do backend sem a checagem `status !== 'pendente'`, exatamente os 2 testes certos falham (conta ativa e conta **inativa** — a que reabriria um acesso desativado por admin). Frontend: página `/reenviar-confirmacao`, link no login e correção de `/cadastro/confirmado` — o texto "Cadastre-se novamente pra receber um novo" era **falso** (recadastrar dá 409, era o beco sem saída). Navegador: 16/16 em 1280 e 390 px | **Não implantado** (código novo fora de produção). O e-mail de reenvio usa saudação genérica (sem consultar o nome; evita nova função SQL). O e-mail em si é capturado por fake no e2e — **entrega real pelo Resend não testada**. Fail-open se o Redis cair (o limite da rota segue valendo). A tela de login continua mostrando "Credenciais inválidas" também para conta pendente e para 429 (fora do escopo; o link novo ajuda quem está pendente) |
| 024 | Concluído (documento) | `PRODUCT.md` deixou de afirmar "nenhuma chamada de IA existe" e "sem IA em produção alguma" (falso desde a Fase 9/10). Nova seção "IA" em Operating Context com os 3 agentes, o provedor de cada um, o que está dormente (Ata por áudio, sem `GROQ_API_KEY`), as regras (IA não é autoridade normativa, aprovação humana no fluxo normativo, provedor/modelo só com autorização) e o estado da minimização de PII **marcado como não implantada em 2026-09-28**. O princípio de comunicação passou a citar "dormente" e deixou de tratar IA e Admin como não construídos | Só o documento: **não verifiquei as páginas públicas** (marketing, `/seguranca`, política de privacidade), que podem ainda dizer "IA em construção" ou omitir os provedores — ver ITENS 043 a 045. Fatos vêm da auditoria de leitura de código, não de execução |
| 025 | Implementado e **VERIFICADO com prova de detecção**; sem CI (ITEM 044) | Configuração HTTP extraída de `main.ts` para `src/app-setup.ts` (`configureApp`), **sem mudar o comportamento** — `main.ts` só a chama; o teste usa a MESMA função (antes, os e2e usavam `Test.createNestApplication()` puro e não tinham o `ValidationPipe` global de produção). `app-setup.e2e-spec` (15 casos, passam nas duas fases): helmet em respostas de sucesso e de erro, sem `X-Powered-By`; CORS — 3 origens permitidas recebem a própria origem (nunca `*`), origens recusadas (inclusive `http://` e `montesesst.com.br.evil.com`) não recebem o cabeçalho, sem `Origin` continua permitido, preflight só com os métodos/cabeçalhos da lista e cache de 24 h; `ValidationPipe` — campo extra, tipo errado, ausência e `{ $ne: null }` são 400 numa rota sem `@UsePipes` próprio; `trust proxy` = 1; `allowedOrigins` ignora `PUBLIC_APP_URL` vazia. **Prova de detecção (cópias do backend):** sem `helmet` + sem `ValidationPipe` → 4 testes falham (2 e 2); `enableCors()` aberto → 6 falham. O validador de ambiente já tinha 30 testes (ITEM 010) | **Observação P4 achada aqui:** uma origem recusada vira **500 com log nível `error` e stack** (o middleware de CORS lança erro, o `AllExceptionsFilter` o trata como falha interna). Tem um efeito protetor (a requisição nem chega à rota), mas polui o monitoramento de 5xx com tráfego de scanner; melhor seria um 403 explícito antes do CORS, com log `warn` — **não alterei** (muda comportamento de segurança). Também: sem CI, roda só quando alguém executa; o refactor do `main.ts` está verificado pelo boot real (ITEM 040) |
| 040 | Conserto aplicado; **boot real VERIFICADO em 2026-09-28 15:22** | `auth.e2e-spec` 4/4 (falhava 4/4 no HEAD limpo). **Boot real:** `npm run build` (o mesmo comando do Dockerfile) compila; `node dist/src/main.js` com `NODE_ENV=production`, contra um clone do banco e um Redis descartável, com valores FALSOS no formato que o validador exige, **sobe**, conecta ao banco (`/health` devolve `db_time`), serve `/plans`, aplica helmet (HSTS, CSP, `X-Content-Type-Options`…), CORS por allowlist e o `ValidationPipe` global (corpo com campo extra → 400). **Boot sem `PUBLIC_APP_URL` e com barra final: morre com código 1** e a mensagem `PUBLIC_APP_URL: ausente/inválido — deve ser uma URL https:// sem barra no final` | Imagem de produção segue defasada (não foi reconstruída nem publicada). O boot usou credenciais falsas: **não prova** que as reais funcionem, só que o código sobe e valida. Os crons não foram exercitados |

**Ensaio completo no clone (2026-09-28).** Clone do dump local mais recente, migrations 0055–0056 (fase A) e depois 0057 (fase B), suíte e2e inteira em cada fase. **Este ensaio não incluiu as migrations 0058–0060 nem os specs `password-reset`, `jwt-token-purpose`, `subscription-supersede` e a versão estendida do `subscription-status-guard`** — esses ainda não foram executados. Resultado: fase A 25 suítes / 91 testes com falha; fase B 11 suítes / 26 testes de 127 / 635. A diferença entre as fases **não é efeito da RLS**: `upload-content-validation` (zip bomb, 2,3 s) e `action-plans-list` passam na B e estouraram o timeout de 5 s na A; `tenant-technicians-minha-empresa` passou na A e estourou na B. A causa **não está estabelecida**. O ensaio rodou **em série** (`--runInBand`, cerca de 13 min por fase), então não é concorrência — uma primeira versão deste texto dizia "em paralelo" e estava errada. Hipóteses (INFERIDAS, não testadas): (a) os contadores de rate limit, que usam o IP de loopback como chave, acumulavam no Redis **de produção** que o script usava, ao longo de várias rodadas no mesmo dia; (b) o `beforeAll` de 5 s não comporta a compilação do `AppModule` no container quando o processo já está longo. **Uma execução única e longa não é um comparador confiável; falhas devem ser reexecutadas isoladamente.** O script do ensaio foi ajustado (Redis descartável em vez do de produção; `PUBLIC_APP_URL` definida) — **ajuste não executado**. As 11 falhas da fase B, por causa provável:

| Suíte (testes) | Causa provável | Grau de certeza |
|---|---|---|
| `normative-minimax-answer` (6), `normative-openrouter-answer` (2) | o retorno ganhou `kind`, `confidence`, `scope` (Fase 10) e o spec ainda espera o formato antigo | **VERIFICADO por git:** não modifiquei nenhum desses arquivos; o serviço foi alterado em 2026-09-25 (`6d6a39f`, Fase 10) e o spec é de 2026-09-21 (`bc2be68`) — spec anterior ao código que ele testa |
| `normative-assistant` (2) | ordem da busca operacional (3 buscas em vez de 2) e aviso `dado_insuficiente` novo numa pergunta "sem gatilho" — mesma família do ITEM 041 | **VERIFICADO por git:** o serviço e o spec não estão entre os arquivos que modifiquei (só o controller de upload e uma fixture de imagem foram). **Continua sem resposta** a dúvida do ITEM 041: se o aviso novo é intencional |
| `normative-sources` (1), `normative-pgvector` (2) | `official_sources_code_unique`: os testes inserem `MTE`/`NR-06`, que já existe nos dados reais clonados | INFERIDO pela mensagem do banco. **Consequência a notar:** como os e2e rodam contra produção por desenho, esses 3 testes também falhariam lá |
| `subscriptions` (2) | os testes chamam o Mercado Pago "real" (o título diz isso) com credenciais falsas → 500 | INFERIDO |
| `tenants-logo` (1) | artefato do harness (host `montese-test.minio` × `minio` esperado) | VERIFICADO na mensagem (o redirect em si funcionou) |
| `register` (1), `register-technician` (1) | `Invalid URL` ao ler o link do e-mail de confirmação | **CONFIRMADO por execução:** `registration.service.ts:118` monta o link com `${process.env.PUBLIC_APP_URL}/…` e o spec não define a variável; com `PUBLIC_APP_URL` definida no container, os dois passam nas duas fases (14:00 e 14:05) |
| `cipa-ata-ai` (7), `tenant-technicians-minha-empresa` (1) | 429 do rate limit / timeout de 5 s do `beforeAll` | **CONFIRMADO para o 429:** `cipa-ata-ai` passou na fase A com Redis novo e deu 429 na B com o mesmo código; com `FLUSHALL` entre as fases passa nas duas. `tenant-technicians-minha-empresa` passou nas duas rodadas do ensaio direcionado (o timeout era intermitente) |

**Nenhuma dessas falhas foi comparada com o HEAD limpo** — a classificação vem só do texto de cada erro. Para fechar: reexecutar em série, com a variável `PUBLIC_APP_URL` definida, as suítes `register`, `register-technician`, `cipa-ata-ai`, `tenant-technicians-minha-empresa`, `tenants-logo`, e rodar as de Fase 10 no HEAD limpo (`git archive`).

**Risco novo, meu — RESOLVIDO (2026-09-28):** `PUBLIC_APP_URL` não era validada pelo `env.validator.ts` e é usada para montar o link de cadastro, o de redefinição de senha e o retorno do checkout. Se faltasse em produção, o e-mail sairia com `undefined/redefinir-senha#…` sem nada acusar o erro. **VERIFICADO:** o container de produção a recebe (`https://montesesst.com.br`). Por isso passou a ser obrigatória no validador (14 variáveis; exige `https://` e **sem barra final**, porque o código concatena `${PUBLIC_APP_URL}/caminho`); `env-validator.unit-spec` 30/30. O valor real de produção satisfaz as duas regras (é o mesmo texto da fixture do teste); o boot real do `main.ts` continua não executado. O texto abaixo é o registro do raciocínio original: Atenuante (INFERIDO): o código já em produção também a usa — `subscriptions.service.ts` monta o `backUrl` do checkout com ela — então provavelmente existe lá, mas **NÃO VERIFICADO** que o container a recebe; só depois de confirmar isso é seguro adicioná-la à lista obrigatória (adicionar antes disso pode pôr o próximo deploy em loop de reinício).

**Ensaio direcionado no clone (2026-09-28 14:00, Redis descartável, `PUBLIC_APP_URL` definida, migrations 0055, 0056, 0058, 0059, 0060 e depois 0057).** 13 suítes por fase. **VERIFICADO:** as 5 migrations aplicam sem erro; `register` e `register-technician` **passam** nas duas fases (confirma a causa do `Invalid URL` e cobre `auth_confirm_email` sob a 0055); `subscription-status-guard` (inclui `/subscriptions/me`), `subscription-supersede` (inclui a regra "a mais nova vence"), `jwt-token-purpose`, `upload-content-validation`, `documents-pii-minimization`, `auth` e `tenant-technicians-minha-empresa` passam; `tenants-rls` **falha na fase A e passa na B**. No `password-reset` (20 casos) passaram, no banco real clonado: o fluxo completo (a senha nova entra e a antiga não), bcrypt, token de uso único, **duas requisições simultâneas com o mesmo token — só uma vence (a troca atômica da 0058 funciona)**, token que morre se a senha mudar por outro caminho, recusa de token de outra finalidade, mensagem idêntica para todo motivo, resposta idêntica para conta existente ou não, e token de reset que não abre sessão. **5 falhas, todas do teste e não do serviço:** (1) o app de teste não aplica o `ValidationPipe` global do `main.ts` (F-15, existe em produção com as mesmas opções), então e-mail malformado devolvia 201; adicionei `@UsePipes` nas duas rotas novas, como o cadastro já faz — em produção é redundante, e a gravidade que eu tinha dado a isso ("virava 500") era exagero; (2) o limite de `reset-password` é por IP e o spec faz ~20 chamadas do mesmo IP (limite 10/h) — passou a limpar a chave a cada teste, e ganhou um teste do próprio limite; (3) o teste de auditoria falhou em cascata pelo mesmo 429. **`cipa-ata-ai` passou na fase A e deu 429 na B com o mesmo código:** os contadores de rate limit persistiam entre as fases — é a evidência que faltava para a hipótese do Redis; o script agora dá `FLUSHALL` antes de cada fase. `tenants-logo`: só o teste conhecido de artefato do harness (o redirect usa o host `montese-test.minio`, o teste espera `minio`); upload, troca e remoção funcionam.

**Reexecução com essas correções (14:05–14:08) — VERIFICADO:** **fase B (migrations 0055–0060 aplicadas): 12 de 13 suítes e 109 de 110 testes passam**; a única falha é o teste de artefato do harness do `tenants-logo`. Fase A (sem a 0057): as 9 falhas são esse mesmo teste mais as 8 da `tenants-rls`, que devem falhar sem a RLS (RED). `password-reset`, `cipa-ata-ai` e todos os demais passam nas duas fases. No clone, ao final: 60 migrations aplicadas, **15** funções `SECURITY DEFINER` todas com `pg_temp` explícito (0 sem `SET`), 49 de 58 tabelas com FORCE RLS.

**Estado ao encerrar a sessão de 2026-09-28 — o que falta executar (nada abaixo foi rodado; o shell do agente ficou sem execução por falha repetida do classificador de comandos):**

1. ~~QA de navegador~~ **FEITO (2026-09-28 13:53):** `next build` compilou e `pw-reset-ui.js` deu **26/26**; `pw-guards-ui.js` deu 26/29, com as 3 falhas restantes só de overflow horizontal no mobile (ITEM 047, achado de layout já existente). O teste foi ajustado para separar o que é do aviso/alerta novos (cabem na tela?) do layout ao redor; **essa versão ajustada ainda não foi reexecutada**.
2. **FEITO (14:00 e 14:05 — ver "Ensaio direcionado" acima; 12 de 13 suítes verdes na fase B, a falha restante é artefato do harness).** Plano original: **novo ensaio em clone do dump real** com as migrations 0058–0060 e os specs `password-reset` (20), `jwt-token-purpose`, `subscription-supersede` (9) e `subscription-status-guard` estendido (inclui `/subscriptions/me`), com Redis descartável e `PUBLIC_APP_URL` definida (o script `rehearsal2.sh` já foi ajustado). Pontos que **nunca executaram** e merecem atenção: a função `auth_reset_password` (0058, plpgsql com `RETURN QUERY UPDATE … RETURNING`; tipos conferidos por leitura: `user_role` e `record_status` existem), `payments_superseded_preapprovals` (0060) e o SQL de idade do `pending` no spec da guarda (trocado por `make_interval` por não depender de inferência de tipo — também não executado).
3. **FEITO:** a falha de `register`/`register-technician` era `PUBLIC_APP_URL` ausente no container de teste; com ela definida os dois passam e `auth_confirm_email` sob a 0055 está coberta. A condição para aplicar a 0055 em produção está atendida — a aplicação em si continua dependendo da sua autorização.
4. **FEITO, com um método diferente do planejado:** `cipa-ata-ai` e `tenant-technicians-minha-empresa` passam; `tenants-logo` tem só o teste de artefato do harness; para a Fase 10 **não** rodei o HEAD limpo (o `AppModule` do HEAD nem compila, ITEM 040) — provei por git que não modifiquei os arquivos dessas suítes nem o código que elas testam (com uma exceção: `normative-assistant.controller.ts`, onde só acrescentei a validação do conteúdo do anexo, sem relação com o que os testes falhos afirmam — ordem da busca operacional e o aviso `dado_insuficiente`).
5. ~~Confirmar `PUBLIC_APP_URL` no container de produção~~ **FEITO:** presente (`https://montesesst.com.br`) e agora obrigatória no validador (ver "Risco novo, meu — RESOLVIDO").
6. ~~Recompilar o frontend após a correção do `<label>`~~ **FEITO:** `next build` compilou com a edição.

**Correção de método (vale para esta auditoria e as anteriores):** as falhas de teste rotuladas "infra externa em ambiente sandbox" (`pdf-text`, `company-document-indexer` etc.) eram, ao menos em parte, falta de `NODE_OPTIONS=--experimental-vm-modules` (flag do `run-backend-tests.sh`). Com a flag, o indexador passa por inteiro. Como rodar testes aqui sem travar: ver memória `reference-running-tests-in-throwaway-container`.

**ITEM 041** — P3 · Testes · Specs defasados após a Fase 10 Phase A. `normative-answer-shared.unit-spec.ts` (2 testes) e `question-notices.unit-spec.ts` (2 testes) falham no HEAD limpo — VERIFICADO, mesmos 4 testes com e sem as minhas mudanças. O código (`6d6a39f`, 25/09) foi reescrito depois dos specs (20–21/09). Para jurisdição e checklist a intenção está preservada com outra redação (o prompt diz que a base é federal e que estadual/municipal não tem chunks suficientes; "NUNCA texto oficial da norma" existe sem o "o" que o teste procura), então parece teste desatualizado. NÃO verificado: a parte "habilitação profissional" do teste, e se o novo aviso `vencimento_vencido` numa pergunta antes "sem gatilho" é intencional. Correção: revisar as asserções contra o comportamento desejado. Critério: os 2 specs verdes.

> Formato por item: Prioridade · Módulo · Problema · Evidência · Impacto · Arquivos · Correção · Teste · Critério de conclusão.

### FASE 1 — P1 (bloqueadores de facto, resolver antes do lançamento)

**ITEM 001** — P1 · Segurança · `.env.bak.20260925-213951UTC` não coberto pelo `.gitignore`.
Evidência: `.gitignore` só ignora `.env` exato; `git check-ignore -v` não bate. Impacto: `git add -A` commitaria secrets reais permanentemente. Arquivos: `.gitignore`, `.env.bak.20260925-213951UTC`. Correção: adicionar `.env.bak*` e `.env.*.bak` ao `.gitignore`; decidir se apaga/move o arquivo. Teste: `git check-ignore -v .env.bak.20260925-213951UTC` deve retornar match. Critério de conclusão: arquivo protegido ou removido, confirmado via `git status` limpo.

**ITEM 002** — P1 · Pagamentos · Cancelamento/inadimplência de assinatura não revoga nenhum acesso.
Evidência: `subscriptions.service.ts:183-194` (`getActiveEmployeeLimit`) retorna `null` para assinatura não-`authorized`; `employees.service.ts:94` trata `null` como "sem limite". Impacto: cliente inadimplente mantém acesso total indefinidamente. Arquivos: `backend/src/payments/subscriptions.service.ts`, `backend/src/employees/employees.service.ts`, `backend/src/auth/auth.service.ts`. Correção: definir política explícita (bloqueio imediato, período de graça, ou downgrade automático) e implementar checagem de status de assinatura ativa nos gates relevantes. Dependências: decisão de negócio do fundador sobre a política. Teste: cancelar assinatura de teste, confirmar que o gate correspondente aplica a nova regra. Critério de conclusão: comportamento documentado e testado em e2e.

**ITEM 003** — P1 · Agentes de IA / LGPD · PII/dado de saúde sem minimização antes de provedor externo.
Evidência: `company-document-indexer.service.ts:59-91` (embedding incondicional no upload), `normative-answer-shared.ts:173-178` (prompt), `ata-ai.service.ts:116` (transcrição). Impacto: nome + dado de saúde de funcionário pode ser enviado a OpenRouter/MiniMax sem necessidade. Arquivos: os três acima. Correção: avaliar com o fundador se é aceitável (talvez já coberto em termos de uso) ou implementar etapa de minimização/redação antes do envio. Teste: verificar ausência de CPF/nome completo no payload enviado ao provider externo. Critério de conclusão: decisão documentada + implementação se necessária.

**ITEM 004** — P1 · Documentos/Segurança · Upload sem antivírus + MIME validado só por Content-Type declarado.
Evidência: `documents.service.ts:86-88` compara só `file.mimetype`; nenhuma lib de magic-bytes; grep por antivírus/clamav retorna zero. Impacto: arquivo malicioso disfarçado pode ser armazenado e distribuído a outros usuários do tenant no download. Arquivos: `backend/src/documents/documents.service.ts`, `documents.controller.ts`. Correção: adicionar verificação de magic bytes (ex.: lib `file-type`) e avaliar integração de varredura antivírus (ex.: ClamAV). Teste: upload de arquivo com extensão/Content-Type falso, esperar rejeição. Critério de conclusão: validação de conteúdo real implementada e testada.

**ITEM 005** — P1 · Banco de dados/Performance · Tabela `documents` sem nenhum índice em 52 migrations.
Evidência: grep confirma zero `CREATE INDEX` tocando `documents` em todo o histórico. Impacto: sequential scan em toda listagem/verificação de vencimento, usada em todo carregamento de dashboard. Arquivos: nova migration em `backend/db/migrations/`. Correção: `CREATE INDEX documents_tenant_id_idx ON documents (tenant_id)` e índice parcial em `expires_at`. Teste: `EXPLAIN ANALYZE` antes/depois em ambiente de teste com volume simulado. Critério de conclusão: índices aplicados via migration, sem regressão de teste e2e.

**ITEM 006** — P1 · Banco de dados/Performance · Busca CAEPI sem índice de texto.
Evidência: `caepi.service.ts:55-71`, `ILIKE '%q%'` em 4 colunas contra `caepi_records` (só PK em `numero_ca`). Impacto: já lento hoje, independente de tenant, com centenas de milhares de registros nacionais. Arquivos: `backend/src/caepi/caepi.service.ts`, migration nova. Correção: `CREATE EXTENSION pg_trgm` + índices GIN trigram, ou full-text search. Teste: medir tempo de busca antes/depois. Critério de conclusão: busca abaixo de um limiar aceitável (ex.: <200ms) com volume real sincronizado.

**ITEM 007** — P1 · Infraestrutura · Backup do Postgres sem cópia externa.
Evidência: `ops/backup-postgres.sh` não tem nenhuma linha de upload R2/S3; credenciais R2 já preenchidas hoje. Impacto: falha total do servidor/disco perde backup e produção juntos. Arquivos: `ops/backup-postgres.sh`, `docs/operations/backups.md` (atualizar também a doc, que está desatualizada quanto ao status das credenciais R2). Correção: adicionar upload do dump para R2 após gerar o backup local. Teste: rodar backup, confirmar objeto no bucket R2, testar restauração a partir dele. Critério de conclusão: ciclo completo backup→upload→restore testado, igual ao already-documented teste local de 18/08/2026.

### FASE 2 — P2 (segurança/arquitetura, antes ou logo após lançamento controlado)

**ITEM 008** — P2 · Multi-tenancy · Dependência única da RLS sem validação de aplicação redundante em dezenas de rotas.
Evidência: `documents.controller.ts`, `epis.controller.ts`, `positions.controller.ts` e outros aceitam `tenant_id` de body/query; já houve bypass real desse padrão (`pente-fino`, corrigido em `9af00d1`). Impacto: qualquer regressão futura de policy vira vazamento imediato sem segunda camada. Correção recomendada: teste automatizado de isolamento tenant-a-tenant em CI cobrindo as rotas mais sensíveis. Critério de conclusão: suite de teste de isolamento rodando em CI para as rotas críticas.

**ITEM 009** — P2 · Multi-tenancy · Tabela `tenants` sem RLS própria. Correção: `ALTER TABLE tenants ENABLE/FORCE ROW LEVEL SECURITY` com policy `admin OR id = current_setting('app.tenant_id')`. Critério: migration aplicada, testes de RLS existentes continuam passando.

**ITEM 010** — P2 · Segurança · `env.validator.ts` incompleto (falta `DATABASE_URL`, `REDIS_URL`, `MERCADOPAGO_ACCESS_TOKEN`, credenciais R2). Arquivos: `backend/src/common/config/env.validator.ts`. Correção: adicionar as 4+ entradas faltantes ao array `REQUIRED`. Critério: `validateProductionEnv()` falha corretamente quando qualquer uma está ausente/inválida (testado).

**ITEM 011** — P2 · Pagamentos · Troca de plano pode gerar cobrança dupla no Mercado Pago. Arquivos: `subscriptions.service.ts:51-106`. Correção: cancelar automaticamente o `preapproval` anterior ao criar um novo. Critério: teste e2e confirmando só 1 assinatura `authorized` por tenant após troca de plano.

**ITEM 012** — P2 · Documentação de config · `.env.example` sem `MERCADOPAGO_*`/`R2_ENDPOINT`/outras vars reais. Correção: completar `.env.example` com todas as chaves lidas em `backend/src`. Critério: nenhuma env real lida no código ausente do exemplo.

**ITEM 013** — P2 · Agentes de IA · MiniMax+OpenRouter acoplados (embedding é ponto único de falha do RAG). Correção: avaliar fallback de embedding provider ou monitoramento dedicado de crédito OpenRouter. Critério: decisão documentada + alerta de crédito baixo, se aplicável.

**ITEM 014** — P2 · Agentes de IA · Sem teto de custo monetário de IA em produção. Correção: adicionar coluna de custo estimado + limite configurável por tenant/dia em `ai-usage`. Critério: limite aplicado e testado.

**ITEM 015** — P2 · Documentos/Performance · Indexação síncrona no request HTTP sem fila. Correção: mover extração/embedding para job assíncrono (fila Redis ou similar). Critério: upload responde rápido independente do tamanho do documento; indexação completa em background verificável.

**ITEM 016** — P2 · Frontend · Dashboard da empresa engole erros de fetch silenciosamente. Arquivos: `frontend/src/app/empresa/dashboard/page.tsx:144-151`. Correção: tratar erro de fetch com mensagem visível, igual ao padrão já usado em `DocumentsPanel.tsx`. Critério: erro simulado de API mostra mensagem ao usuário.

**ITEM 017** — P2 · Frontend · Layouts sem guard de role client-side. Arquivos: `AdminShell.tsx`, `empresa/layout.tsx`, `tecnico/layout.tsx`. Correção: checar role antes de renderizar e redirecionar se incompatível. Critério: acesso a `/admin/*` sem role admin redireciona antes de montar a UI.

**ITEM 018** — P2 · Alertas · Notificação de vencimento só semanal sem escalonamento. Arquivos: `weekly-digest.service.ts`. Correção: cron diário para itens de prioridade alta. Critério: item que vira "vencido" gera e-mail em até 24h.

**ITEM 019** — P2 · Banco de dados · **CONCLUÍDO — decisão do fundador (2026-09-28): nunca apagar de verdade.** `DELETE /company-units/:id` apagava a filial e, em CASCATA, 12 tabelas de histórico de conformidade (CIPA — comitê/membro/pendência/reunião/ata/eleição/DDS/SIPAT —, brigada de incêndio — membro/meta de cobertura —, checklist de prevenção, simulado de emergência), sem confirmação nem aviso do que ia junto. Em produção afetaria hoje 3 filiais e 17 linhas reais (levantado por leitura direta do banco, somente leitura, antes de qualquer mudança). Nenhuma tela do frontend chamava essa rota (só alcançável via API direta), mas ela estava ativa. **Achado extra durante a implementação (não estava na auditoria original):** a filial "matriz" (`is_matriz=true`, a que representa o próprio cadastro da empresa) podia ser apagada pela mesma rota, sem proteção nenhuma — perguntei ao fundador e a resposta foi bloquear sempre. **Correção:** `remove()` nunca mais executa `DELETE`; reaproveita a coluna `status` (já existia na tabela desde a migration 0007, sem nenhum uso até então — nenhum código a lia) e marca `'inativo'`, idempotente. `findAll()` passou a excluir `status='inativo'` por padrão (a filial some do seletor de agendamento de visita e da ficha da empresa vista pelo técnico) com `?includeInactive=true` como a forma de redescobrir o id e reativar via `PATCH { status: 'ativo' }` — rota que já existia, sem UI nova. A matriz é bloqueada nas DUAS portas: `DELETE` e `PATCH status='inativo'` (achei a segunda porta por revisão, antes de qualquer teste — sem ela dava pra contornar a proteção do `DELETE` só trocando de rota). **VERIFICADO no clone (10 casos, `company-units.e2e-spec` + `company-units-rls.e2e-spec`, fases A e B):** desativar não desvincula mais o funcionário (o `ON DELETE SET NULL` nunca dispara, porque não há mais `DELETE` físico — o vínculo fica de pé, é o objetivo); `DELETE` some da listagem padrão mas segue consultável por id e reversível; idempotente numa filial já inativa; a matriz recusa as duas rotas (400) e continua editável nos demais campos. **Prova de detecção (cópias mutadas do backend):** revertendo `remove()` para `DELETE` físico, 6 dos 10 testes falham nos pontos certos; removendo só a proteção do `PATCH` da matriz, falha exatamente 1 teste (o da proteção pela outra porta) — nem mais, nem menos.

**ITEM 020** — P2 · Banco de dados/Performance · Tabelas tenant-scoped pré-Fase 25 sem índice em `tenant_id` (`action_plans`, `tenant_epis`, `employee_epi_deliveries`, `company_units`, `fire_safety_equipment`, etc). Correção: migration retroativa adicionando os índices faltantes. Critério: `EXPLAIN` confirma uso de índice nas queries mais frequentes.

**ITEM 021** — P2 · Banco de dados/Segurança · 3 funções `SECURITY DEFINER` sem `SET search_path` (`auth_register_tenant_and_user`, `auth_register_technician`, `auth_confirm_email`). Correção: `ALTER FUNCTION ... SET search_path = public, pg_temp` nas 3. Critério: migration aplicada, testes de auth continuam passando.

**ITEM 022** — P2 · Autenticação · Sem fluxo de recuperação de senha. Correção: implementar fluxo de reset com token de uso único e expiração curta. Critério: e2e cobrindo solicitação, uso do token, invalidação após uso.

**ITEM 023** — P2 · Onboarding · Sem reenvio de e-mail de confirmação de cadastro. Correção: endpoint de reenvio (rate-limited) para registro pendente existente. Critério: usuário com link expirado consegue receber novo link sem esbarrar em 409.

**ITEM 024** — P2 · Documentação de produto · `PRODUCT.md` desatualizado (afirma ausência de IA em produção). Correção: atualizar seção "Operating Context" para refletir os 3 agentes reais. Critério: documento revisado e commitado.

**ITEM 025** — P2 · Testes/Processo · Hardening de segurança P0 sem teste automatizado. Correção: adicionar testes cobrindo ValidationPipe/CORS allowlist/helmet/env-validator. Critério: suite de teste dedicada, rodando em CI.

### FASE 3 — P3 (backlog pós-lançamento)

**ITEM 026** — P3 · Documentos · Sem dedup por hash. Correção: checar hash antes de gravar novo objeto. Critério: reenvio idêntico não duplica armazenamento.

**ITEM 027** — P3 · Segurança · **CONCLUÍDO.** `credentials: true` desnecessário no CORS — corrigido para `false`. Evidência de que era seguro: grep em `frontend/src` e `backend/src` por cookie/`document.cookie`/`Set-Cookie`/`withCredentials` não achou nenhum uso fora de comentários; a sessão é 100% Bearer token em `Authorization`. VERIFICADO no clone: `app-setup.e2e-spec` 16/16 nas duas fases (caso novo: origem permitida não recebe `Access-Control-Allow-Credentials`, nem em requisição normal nem em preflight); confirmado também no boot real (ITEM 040). Critério de conclusão atendido: nenhuma regressão funcional.

**ITEM 028** — P3 · Frontend · Mensagens de erro genéricas em onboarding/cadastro. Correção: propagar mensagem específica do backend em `MatrizForm`/`FiliaisForm`, e distinguir campo duplicado (CNPJ vs e-mail). Critério: mensagem específica exibida em cada caso testado.

**ITEM 029** — P3 · Testes · Sem e2e para reenvio duplicado de `subscription_preapproval`. Correção: adicionar teste. Critério: teste cobrindo reenvio idêntico sem duplicar efeito.

**ITEM 030** — P3 · Pagamentos · **CONCLUÍDO.** Sem reconciliação periódica banco↔Mercado Pago — um webhook perdido deixava a assinatura desatualizada pra sempre, sem nada perceber. `SubscriptionReconciliationCronService` (a cada 6h): busca `subscriptions` com status `pending`/`authorized` e `mercadopago_preapproval_id` não nulo, consulta o status real via `GET /preapproval/{id}` e, se divergir, aplica a MESMA função SQL do webhook (`payments_update_subscription_status`) — nunca duplica a lógica de decisão, só a dispara a partir de outro gatilho. Quando o status confirmado vira `authorized`, também chama `supersedePreviousAuthorized` (ITEM 011), pela mesma razão do webhook: sem isso a reconciliação podia deixar duas assinaturas `authorized` do mesmo sujeito. Uma falha numa linha (rede, erro do Mercado Pago) não interrompe as demais do lote. **VERIFICADO no clone (8 casos, `subscription-reconciliation.e2e-spec`, fases A e B):** authorized←pending, cancelled←authorized (webhook perdido), status já batendo não gera chamada de escrita nenhuma, integração com o supersede do ITEM 011, `cancelled`/`paused` nunca são nem consultadas (fora do escopo), falha parcial não trava o lote, ramo técnico, `mercadopago_preapproval_id` nulo é ignorado. **Prova de detecção:** removendo a chamada ao supersede, falha exatamente o teste de supersede; removendo o filtro de status da consulta, falham os 2 testes que dependem dele (a mutação também mostrou o efeito colateral real: sem o filtro, o cron passa a mexer em assinaturas de OUTROS tenants que já estavam canceladas em testes anteriores, virando-as `authorized`).

**ITEM 031** — P3 · Pagamentos · **CONCLUÍDO — decisão do fundador (2026-09-28): avisar no momento do downgrade, nunca desativar funcionário.** Comportamento mantido: `assertEmployeeLimitNotExceeded` (`employees.service.ts`) só bloqueia CADASTRAR um funcionário além do limite; nenhum funcionário existente é desativado ao trocar de plano. **Novo:** `GET /subscriptions/downgrade-check?plan_id=X` (role `empresa`, isento do bloqueio de assinatura pelo mesmo motivo de `POST /subscriptions` — é parte do mesmo fluxo) — somente leitura, não cria nada, não chama o Mercado Pago; compara funcionários ATIVOS do tenant contra o `employee_limit` do plano escolhido e devolve um aviso quando excede (planos sem limite, como Enterprise, nunca avisam). No frontend (`/planos`), a empresa logada consulta essa rota ANTES do checkout; havendo aviso, um diálogo modal (`role="dialog"`) mostra o texto e exige `Continuar mesmo assim` ou `Cancelar` antes de qualquer `POST /subscriptions` — sem aviso, ou se a checagem falhar, segue direto (nunca bloqueia o fluxo por causa disto). **VERIFICADO no clone (13 casos, `subscription-downgrade-check.e2e-spec`, fases A e B):** sem excedente / com excedente (mensagem cita o limite e a contagem certos) / exatamente no limite (não avisa) / funcionário inativo não conta / plano sem limite nunca avisa / isolamento entre tenants / plano de técnico ou inexistente ou UUID inválido → 404 (não 500) / só `empresa` acessa (técnico e admin → 403) / exige login / acessível com assinatura inativa / não grava nada no banco. **Navegador (Chromium, 12 casos, desktop e mobile):** sem excedente assina direto sem mostrar o diálogo; com excedente o diálogo aparece ANTES do `POST /subscriptions`; `Cancelar` fecha sem assinar; `Continuar mesmo assim` segue pro checkout com o plano certo; checagem indisponível (500) não bloqueia; sem overflow horizontal, sem erro de console. **Prova de detecção:** um off-by-one na comparação (`<` no lugar de `<=`) derruba exatamente o teste "exatamente no limite"; remover o filtro `status = 'ativo'` da contagem derruba exatamente o teste do funcionário inativo.

**ITEM 032** — P3 · Documentos · Falha de upload R2 sem mensagem amigável. Correção: capturar erro e devolver mensagem específica. Critério: erro simulado de R2 mostra mensagem clara ao usuário.

**ITEM 033** — P3 · Integrações · Falha de Google Calendar silenciosa para o usuário. Correção: notificar usuário quando token for revogado/expirado, sugerindo reconexão. Critério: cenário de token revogado gera aviso visível.

**ITEM 034** — P3 · Infraestrutura · Sem healthcheck em redis/backend/frontend/nginx. Correção: adicionar healthcheck a cada serviço no compose. Critério: `docker compose ps` reporta `healthy` para todos os serviços.

### ITEM ADICIONADO EM 2026-09-28 (achado durante a execução dos itens)

**ITEM 040** — P0 · Backend/Deploy · `AppModule` não compila no HEAD: `RateLimitGuard` injeta `JsonLoggerService`, que não era provider de nenhum módulo.
Evidência (VERIFICADO): `git archive HEAD` extraído sem nenhuma mudança minha + `auth.e2e-spec.ts` existente → 4/4 falham com "Nest can't resolve dependencies of the RateLimitGuard (Reflector, RedisService, ?)… JsonLoggerService at index [2]". Introduzido pelo commit `4105817` (F-22). Os testes unitários do F-22 instanciam o guard à mão, por isso não pegaram. Impacto: nenhum e2e que importa `AppModule` rodava, e um build/deploy do HEAD deve falhar no boot (INFERIDO: a resolução de DI é a mesma do `NestFactory.create`, mas o boot do `main.ts` não foi executado). A produção está de pé porque a imagem do container `montese_backend` é anterior a esse commit (também não contém as migrations 0051–0054). Arquivos: `backend/src/app.module.ts`, `backend/src/common/rate-limit/rate-limit.guard.ts`, `backend/src/common/logging/json-logger.service.ts`. Correção aplicada em 2026-09-28: `JsonLoggerService` registrado em `providers` do `AppModule`. Validação: `auth.e2e-spec` passa 4/4 depois do conserto. **Pendente:** confirmar o boot real (`node dist/src/main.js`) antes de qualquer deploy, e definir por que a imagem em produção está defasada em relação ao `main`.

**Nota sobre o F-22 nesta auditoria:** a seção 3 listou F-22 como "confirmado corrigido" com base na presença do código. O código estava presente, mas introduzia esta quebra de boot. Deve ser lido como "implementado, com regressão corrigida no ITEM 040".


**ITEM 042** — P2 · Autenticação · **`JwtStrategy` aceitava qualquer JWT assinado como sessão.** Achado ao desenhar o ITEM 022. A estratégia montava o usuário só com `sub`/`tenantId`/`role`, sem olhar `purpose`; o token de confirmação de cadastro (enviado por e-mail, 48h) valia como Bearer, com `role` indefinida. **Provado antes de corrigir:** `jwt-strategy.unit-spec` falhou em 6 de 11 casos contra o código antigo. **Corrigido:** `validate()` exige `sub`, um dos 4 papéis conhecidos e nenhum `purpose`; unit 11/11. Spec e2e `jwt-token-purpose.e2e-spec.ts` (usa `/auth/me` com tokens de e-mail) passa no clone (14:00 e 14:05).
Observação relacionada, **sem correção** (decisão sua): `auth_confirm_email` marca qualquer usuário como `ativo` a partir do id, sem olhar o estado atual — um link de confirmação ainda válido (48h) poderia reativar uma conta desativada por um admin.

**Refinamento do ITEM 002 (descoberto no ITEM 011):** linhas `pending` nunca expiravam, então um cliente que cancelou e abandonou um checkout ficaria com um `pending` eterno e nunca seria bloqueado. A guarda agora só conta `pending` criado nos últimos 3 dias. Cobertura: 2 casos novos em `subscription-status-guard.e2e-spec.ts` (passam no clone).


### Textos públicos de segurança e privacidade × o que foi verificado (2026-09-28)

Ao usar o CNPJ nos documentos de privacidade (feito: `lgpd-compliance.md` §2, `processo-incidentes.md` §5, `matriz-conformidade.md`; o rodapé **já** mostrava o CNPJ em todas as áreas), li as páginas públicas contra as evidências da auditoria. **Nenhuma página publicada foi alterada** — texto público e jurídico é decisão do fundador. As propostas abaixo são rascunhos para revisão.

**ITEM 043** — P1 · Privacidade · **A Política de Privacidade não divulga o uso de provedores de IA nem outros operadores.** A seção "Com quem compartilhamos" lista só e-mail, pagamento e armazenamento de documentos. O sistema envia dados a: **MiniMax** (resposta do Assistente), **OpenRouter** (embeddings de documentos e perguntas; copiloto de checklist; extração de ata), **Groq** (transcrição de áudio de reunião de CIPA — dormente), **Google Calendar** (agenda de técnicos), além de Resend, Mercado Pago e Cloudflare R2. Os dados incluem texto de PGR/PCMSO/LTCAT/LIP (pode haver dado de saúde ocupacional), perguntas, anexos e relatos de inspeção. É exatamente o que motivou a minimização do ITEM 003, mas o texto público não acompanha. **NÃO VERIFICADO:** onde ficam os servidores desses provedores (transferência internacional, art. 33 da LGPD) e o que os contratos deles preveem — depende de contratos/DPAs e de validação jurídica.
*PROPOSTA (rascunho, exige revisão jurídica), a acrescentar em "Com quem compartilhamos":* "**Recursos de inteligência artificial** — quando você usa o Assistente, a extração de documentos ou a transcrição de reuniões, o conteúdo enviado (por exemplo, trechos de documentos de SST, sua pergunta ou um relato) é processado por provedores de IA contratados. Antes do envio, mascaramos CPF e nomes de funcionários cadastrados. A IA não é a autoridade normativa e nada é gravado sem revisão humana. ⚠️ [informar países/base legal de transferência após validação jurídica]."

**ITEM 044** — P2 · Segurança · **`/seguranca` afirma que o isolamento entre empresas "é verificado automaticamente a cada mudança no sistema" — sem sustentação.** Não existe nenhum CI no repositório (nem `.github`, nem pipeline) e o repositório nem tem remoto git; os testes rodam manualmente, os e2e rodam **contra o Postgres de produção** (`jest-e2e-setup.ts`) e, no HEAD, a suíte e2e nem compilava (ITEM 040). O isolamento em si está bem verificado (RLS, testes rigorosos), mas a frase promete um processo que não existe. Duas saídas: (a) ajustar o texto para o que é verdade; (b) criar de fato o processo — CI com Postgres descartável (as migrations + suíte de RLS), o que também elimina o risco de testar em produção. Recomendo (b); até lá, (a).
*PROPOSTA de texto para (a):* "esse isolamento é coberto por testes automatizados que executamos [antes de publicar mudanças relevantes]." — só vale depois de isso ser regra de processo. Ajuste de redação relacionado: "Rastreabilidade … não pode ser apagada nem alterada" é verdade para a aplicação (o banco revoga UPDATE/DELETE/TRUNCATE dela), não para o superusuário do Postgres — trocar por "não pode ser apagada nem alterada pela própria plataforma".

**ITEM 045** — P3 · Segurança · **`/seguranca` (Limitações) está defasada:** diz que a cópia de segurança "fica na mesma infraestrutura" e que a cópia externa "ainda está em planejamento". Desde 2026-09-28 existe cópia externa no R2 (ITEM 007), com ressalvas que o texto deveria conter: mesma conta/bucket/credenciais da aplicação e sem criptografia do lado do cliente. *PROPOSTA:* "mantemos uma cópia externa dos backups em outro provedor; ela ainda usa as mesmas credenciais da aplicação e não tem criptografia própria, o que estamos endurecendo".

**ITEM 046** — P1 · Continuidade · **O código-fonte tem uma única cópia, no disco desta VPS.** `git remote` vazio; o backup do ITEM 007 cobre só o banco. Perder a VPS perde 576 commits (e o trabalho não commitado). Opções: repositório privado remoto (decisão sua sobre onde hospedar) e/ou `git bundle` periódico para o R2. **Antes de enviar o histórico para qualquer lugar, varrer o histórico por segredos** (há registro de incidentes de exposição de segredo em fases anteriores — memória do projeto) — não fiz essa varredura. Critério de conclusão: cópia do repositório fora da VPS, restaurada e conferida.

**ITEM 047** — P2 (subi de P3 depois de ver o screenshot) · Frontend · Responsividade · **O layout logado não se adapta a telas pequenas.** Achado pelo QA de navegador do ITEM 016/017 (Chromium, viewport 390 px). Evidência visual (`pw-out/mobile-10…12`): a sidebar ocupa mais da metade da tela, o conteúdo vira uma coluna estreita e palavras ficam cortadas na borda direita ("segurança", "Documentos"). Para um produto de SST usado por equipes em campo, isso pesa; a decisão de prioridade é sua. A `EmpresaSidebar` tem largura fixa e sempre visível (`w-56 shrink-0`, 224 px), deixando ~166 px para o conteúdo; a página `/empresa/dashboard`, **no estado normal**, estoura 79 px na horizontal (o `main` precisa de 237 px). Nesse estado o DOM é o mesmo de antes das mudanças do ITEM 016/017 (o `RoleGuard` só embrulha e o aviso renderiza `null`), então **não é regressão** — INFERIDO por essa igualdade, não medido no HEAD. Pelo mesmo padrão de código o layout do técnico deve ter o mesmo limite (**NÃO verificado**; o admin usa outro componente). Junto: há **dois `<h1>` por página** (a marca "Montese SST" da sidebar e o título da tela). **Não corrigido:** exige decisão de UX (sidebar como gaveta com botão de menu abaixo de `md`, `min-w-0` no `main`) e afeta três layouts; o AGENTS.md pede responsividade, mas não fiz redesenho de navegação sem pedido. Critério de conclusão: sem overflow horizontal a 390 px nas telas principais das áreas empresa e técnico. O aviso de assinatura e o alerta de erro novos são testados à parte (cabem na tela?) para não serem confundidos com este problema.

### FASE 4 — P4 (melhoria futura)

**ITEM 035** — P4 · Segurança · Rota pública de logo permite enumeração de tenant. Correção: avaliar necessidade de manter pública ou restringir.
**ITEM 036** — P4 · Frontend · Botão de apagar documento oculto para admin. Correção: mostrar botão quando `user.role === 'admin'` também.
**ITEM 037** — P4 · Frontend · Ícones sociais decorativos no rodapé público. Correção: apontar para URLs reais ou remover.
**ITEM 038** — P4 · Documentos · Inconsistência de categorias entre DTO/service/schema (documentada). Correção: alinhar `CreateDocumentDto.category` com `ALLOWED_CATEGORIES` por clareza, mesmo sem bug ativo.
**ITEM 039** — P4 · Documentos · Rota de download sem `@Roles()` explícito. Correção: adicionar decorator por defesa em profundidade, mesmo com RLS já protegendo.

---

## 18. Ordem correta de execução

**FASE 1 — P1 / bloqueadores de facto**
001, 002, 003, 004, 005, 006, 007

**FASE 2 — Segurança e arquitetura multi-tenant**
008, 009, 010, 021, 022

**FASE 3 — Banco/Performance**
019, 020

**FASE 4 — Pagamentos**
011, 012, 030, 031

**FASE 5 — Agentes de IA**
013, 014

**FASE 6 — Frontend/Onboarding/UX**
016, 017, 023, 028

**FASE 7 — Produção/Observabilidade**
018, 024, 025, 034

**FASE 8 — Backlog (P3/P4 restantes)**
026, 027, 029, 032, 033, 035, 036, 037, 038, 039

---

## 19. Critério de "pronto para produção"

- [x] Multi-tenancy validado (nenhum vazamento encontrado; itens 008/009 são endurecimento, não bloqueio)
- [x] Segurança validada (todos os P0 anteriores confirmados corrigidos; itens 001/004/010 pendentes)
- [ ] Backup validado com cópia externa (item 007 pendente)
- [ ] Pagamentos validados — cancelamento deve revogar acesso (item 002 pendente)
- [x] Cadastro validado (funcional; item 023 é melhoria, não bloqueio)
- [x] Agentes validados (funcionais e com guardas anti-alucinação; item 003 é pendência de LGPD, não de funcionamento)
- [x] RAG validado (isolamento cross-tenant confirmado seguro)
- [ ] Upload validado (item 004 — antivírus/MIME — pendente)
- [x] E-mail validado (múltiplos fluxos reais confirmados)
- [x] Logs validados (estruturados, com request_id, sem vazamento de stack trace)
- [ ] Monitoramento/alerta ativo além de log (não implementado — decisão consciente de escopo, registrada em `docs/operations/reliability.md`)
- [x] SSL validado (TLS 1.2/1.3, HTTP/2, headers de segurança presentes)
- [ ] Produção validada 100% (pendências de `.env.example`/`env.validator.ts`, itens 010/012)
- [x] Rollback validado (backup local restaurável, testado; falta só a cópia externa)
- [ ] Testes críticos passando — **CORREÇÃO (2026-09-28):** a auditoria original marcou este item sem ter executado a suíte e2e (só leu os arquivos de teste). Ao executá-la, descobriu-se que **nenhum e2e que monta o `AppModule` rodava no HEAD** (ver ITEM 040). Os 160 arquivos existem e a qualidade de escrita dos testes de RLS continua sendo o que foi descrito, mas "passando" não estava comprovado.

### VEREDITO TÉCNICO

## **B — APTO COM PENDÊNCIAS NÃO BLOQUEADORAS**

O sistema pode ir para um lançamento controlado (poucos clientes, acompanhamento próximo) **depois de resolver os 7 itens da FASE 1 (001-007)**, que são de esforço individualmente baixo a moderado. Nenhum vazamento cross-tenant foi encontrado — o risco mais temido de um SaaS multi-tenant está sob controle. Os itens que impedem o veredito **A** são especificamente:

- **001** (`.env.bak` fora do `.gitignore`) — corrigível em minutos.
- **002** (cancelamento não bloqueia nada) — exige decisão de negócio + implementação, é o item de maior risco financeiro/de produto.
- **003** (PII sem minimização para IA externa) — exige decisão do fundador sobre aceitabilidade + possível implementação.
- **004** (upload sem antivírus/MIME real) — exige escolha de biblioteca/serviço de varredura.
- **005/006** (índices de banco) — corrigíveis via migration em horas.
- **007** (backup externo) — as credenciais já existem, falta só a lógica de upload no script já existente.

Recomendo resolver 001, 005, 006 e 007 primeiro (baixo esforço, alto retorno), depois decidir com o fundador as políticas de negócio por trás de 002 e 003 antes de implementá-las, e então tratar 004.
