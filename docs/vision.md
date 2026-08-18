# Visão do Projeto — Montese SST

> Este documento é a base de decisão do projeto: o porquê antes do como.
> Documentos técnicos (`roadmap.md`, specs futuras) detalham *o quê* e
> *quando*; este aqui registra *por quê* e *para quem*, para que decisões de
> arquitetura, produto e conformidade tenham um ponto de referência comum.
>
> Escrito a partir do briefing fundador original (reproduzido na íntegra na
> seção 6) e de respostas do fundador durante a sessão de brainstorming de
> 2026-08-17.

## 1. Resumo executivo

Montese SST é uma plataforma SaaS de gestão de Saúde e Segurança do
Trabalho (SST) para o mercado brasileiro, com foco inicial na região Sul de
Santa Catarina. Não é apenas um software de conformidade: é uma plataforma
que conecta três papéis — a empresa cliente, o técnico de segurança
responsável (atuação remota) e o técnico parceiro (visitas presenciais) —
substituindo um processo hoje fragmentado entre e-mails, PDFs soltos e
planilhas por um sistema único com histórico e rastreabilidade completos.

## 2. Problema e oportunidade

Qualquer empresa com CNPJ e funcionários CLT é obrigada, por lei, a manter
processos de SST em dia — PGR, PCMSO, laudos, fichas de EPI, treinamentos,
inspeções periódicas. Na prática, a maioria não tem estrutura interna para
isso e depende de terceirização. Essa terceirização hoje é operada de forma
manual e dispersa: documentos trocados por e-mail, controles em planilha,
visitas técnicas registradas em papel ou formulários soltos, sem um lugar
único onde a empresa cliente, o técnico responsável e o técnico parceiro
enxerguem o mesmo estado de conformidade em tempo real.

A oportunidade não é só digitalizar esse processo — é estruturá-lo em uma
plataforma multi-tenant que dá à empresa cliente visibilidade contínua
("score de SST", pendências, vencimentos) e aos técnicos as ferramentas de
campo (carteira de clientes, agenda, checklist de visita) que hoje não
existem de forma unificada.

## 3. Proposta de valor e diferencial

> "Tecnologia que organiza. Gestão que protege."
> "Conectamos pessoas, processos e segurança para chegar mais alto."

O diferencial competitivo do Montese **não é a tecnologia isolada — é o
atendimento humano combinado com a rede de técnicos parceiros**. A
plataforma existe para tornar essa rede mais eficiente e mais confiável, não
para substituí-la por automação genérica. Isso tem uma implicação direta de
produto: funcionalidades que enfraquecem o vínculo entre a empresa cliente e
seu técnico responsável (por exemplo, automações que escondem quem fez o
quê) vão contra o diferencial central e devem ser evitadas.

Para a **empresa cliente**: mais controle, conformidade e redução de riscos
— um único painel para tudo que hoje está espalhado.
Para o **técnico de SST** (responsável ou parceiro): mais produtividade,
organização e eficiência no dia a dia de campo.

## 4. Identidade de marca

A marca já está definida e deve orientar todo o frontend institucional e de
produto daqui em diante.

- **Nome e conceito:** Montese — inspirado em colina italiana, símbolo de
  solidez, elevação e visão estratégica. O símbolo combina montanha
  (solidez/elevação) com capacete e escudo (proteção, cuidado, conformidade).
- **Tagline principal:** "Tecnologia que organiza. Gestão que protege."
- **Tagline alternativa:** "Chegue no topo com segurança."
- **Paleta de cores:** tons de verde — de um verde escuro profundo a um
  verde claro/menta, com branco como base neutra. *(Os valores hexadecimais
  exatos estão no arquivo de identidade visual original fornecido pelo
  fundador — confirmar essa paleta com o arquivo-fonte antes de codificar
  variáveis de tema no frontend, para não propagar um valor lido
  incorretamente de uma imagem.)*
- **Tipografia:** Poppins.
- **Aplicações já definidas:** logo horizontal principal, submarca/ícone
  (para favicon e app mobile), variações circulares, aplicação em fachada,
  cartão de visita, e mockup de dashboard (web + mobile) já ilustrando os
  módulos-chave: empresas cadastradas, documentos, vencimentos, treinamentos
  e indicador de conformidade (%).

**Ação pendente:** os arquivos-fonte do logo (vetor/alta resolução) ainda
não estão versionados no repositório — precisam ser adicionados em local
próprio (ex.: `docs/brand/` ou `frontend/public/brand/`) assim que o
fundador puder enviá-los como arquivo, não apenas como imagem colada na
conversa.

## 5. Papéis da plataforma

Já implementados no schema (`backend/db/migrations/0001_init.sql`) e
reafirmados aqui como parte da visão, não só do banco de dados:

- **Empresa (cliente):** contrata o serviço, gerencia seus funcionários,
  acompanha score de conformidade, documentos e agenda.
- **Técnico responsável:** atuação remota, carteira de clientes, emite e
  acompanha relatórios e planos de ação.
- **Técnico parceiro:** atuação presencial, executa visitas técnicas e
  preenche checklists de inspeção em campo.
- **Admin:** operação da própria Montese — visão global, sem isolamento de
  tenant.

## 6. Público-alvo e mercado

Qualquer empresa com CNPJ e funcionários CLT, sem foco setorial específico
— a obrigação legal de SST não é exclusiva de indústria ou construção civil,
é de qualquer empregador CLT. O foco geográfico inicial é a região Sul de
Santa Catarina, deliberadamente regional: validar o modelo de atendimento
humano + rede de parceiros num raio geográfico controlável antes de
expandir.

## 7. Postura de crescimento

Meta de escala para o ano 1: **dezenas de empresas na região Sul de SC**,
não centenas ou milhares — a prioridade explícita do fundador é **solidez
antes de velocidade**. Não há prazo rígido para o MVP começar a vender.
Isso significa que, quando este projeto entrar nas frentes de LGPD,
auditoria e escala técnica (seção 9), a régua de sucesso é robustez e
confiabilidade demonstrável, não velocidade de lançamento. Dito isso, a
arquitetura (multi-tenant com RLS desde o dia 1, containers separados) já
foi escolhida pensando em expansão além da região inicial sem reescrita.

## 8. Princípios não-negociáveis de arquitetura

Reproduzidos aqui a partir do briefing fundador original, porque hoje só
existiam espalhados em decisões de código e no roadmap — este é o lugar
central onde qualquer decisão futura deve ser conferida contra eles:

1. **PostgreSQL é o único banco relacional.** Multi-tenant via `tenant_id` +
   Row-Level Security em toda tabela desde o dia 1 — não é algo a
   "adicionar depois".
2. **Documentos (PDFs, fotos, laudos) nunca ficam no disco da VPS.** Sempre
   object storage S3-compatible externo (Cloudflare R2). Qualquer upload
   precisa de confirmação explícita antes de implementar.
3. **PostgreSQL e Redis nunca expostos publicamente** — apenas rede interna
   Docker.
4. **Sem IA local em produção.** Toda chamada de IA é via API externa.
5. **Um serviço por container Docker**, mesmo rodando tudo numa única VPS
   hoje — facilita separar depois sem reescrever.
6. **Nunca apresentar mock como funcional.** Toda validação é feita com
   output real de terminal/log — nunca um resumo do que "deveria" ter
   acontecido.

## 9. Compromissos de confiança

Escalar significa, por definição, várias empresas clientes com dados
sensíveis de seus funcionários (CPF, dados de saúde ocupacional, ASO)
convivendo na mesma infraestrutura ao mesmo tempo. Isso não é um requisito
adicional depois do produto pronto — é parte da proposta de valor: uma
empresa só confia dados de SST de seus funcionários a uma plataforma que
consegue demonstrar, com evidência, que:

- **Isolamento entre clientes é real e auditável** — a base já existe (RLS
  em toda tabela), mas precisa de trilha de evidência (testes automatizados,
  logs de acesso) para virar prova, não só afirmação.
- **Dados pessoais são tratados conforme a LGPD** — base legal para cada
  dado coletado, retenção definida, direitos do titular (acesso, correção,
  exclusão) implementados como funcionalidade, não como promessa.
- **O sistema é auditável de ponta a ponta** — quem acessou o quê, quando,
  e o que mudou, com registros que resistem a uma auditoria externa real.
- **A operação é confiável em escala** — múltiplos tenants ativos ao mesmo
  tempo sem degradação, com observabilidade (não descoberta de problema pelo
  cliente antes da Montese).

Este documento não detalha *como* — cada um desses quatro pontos vira sua
própria spec e plano de implementação, no mesmo modelo de fase única do
roadmap técnico. O que este documento estabelece é que **nenhum desses
pontos é opcional ou "fase futura distante"**: eles são parte da definição
de pronto para vender, não um polimento pós-lançamento.

## 10. Mapa de documentação do projeto

| Documento | Conteúdo | Status |
|---|---|---|
| `docs/vision.md` | Este documento — por quê e para quem | ✅ |
| `docs/roadmap.md` | Fases do MVP, status técnico item a item | ✅ (existente, mantido por fase) |
| `docs/reference/modelos-relatorios-sst.md` | Modelos reais de relatório de EPI e visita técnica, referência para schema das Fases 4/5 | ✅ |
| [`docs/compliance/lgpd-compliance.md`](compliance/lgpd-compliance.md) | Mapeamento de dados pessoais, base legal, retenção, direitos do titular | ✅ |
| Spec de Escala + Auditoria + Confiabilidade | Pooling, observabilidade, rate limiting, trilha de auditoria, backups/DR | ✅ — backup ([`docs/operations/backups.md`](operations/backups.md)), trilha de auditoria (`backend/db/migrations/0002_audit_log.sql`) e pooling/observabilidade/rate limiting ([`docs/operations/reliability.md`](operations/reliability.md)) feitos. Pendências pontuais documentadas em cada doc (cópia externa de backup, alerta automático, painel visual) |
| Documentação técnica de arquitetura (ADRs) | Decisões técnicas registradas conforme tomadas (ex.: por que NestJS) | 🔜 a estruturar |

## 11. Estado atual e próximos passos

Snapshot rápido (atualizado em 2026-08-18) — detalhes completos e sempre
atualizados em `docs/roadmap.md`:

- **Fase 1 (Fundação): concluída.** Docker Compose, RLS, auth JWT, CRUDs
  core, testes automatizados, seed versionado, login no frontend, git.
- **Fase 2 (Site institucional): concluída**, incluindo teste real de
  ponta a ponta (cadastro → e-mail de confirmação real via Resend → link
  clicado → conta ativada → login). Ver `docs/roadmap.md` seção "Fase 2 —
  Site institucional: status". Pendência não-bloqueante: domínio próprio
  ainda não verificado na Resend (usa domínio de sandbox por enquanto).
- **Fases 3 a 8** (onboarding, dashboards, visita presencial, admin, IA)
  ainda não iniciadas. Uma peça nova fora do roadmap original entrou na
  frente: integração de pagamento (Mercado Pago), pedida pelo fundador,
  decomposta em cadastro próprio de técnico + planos/assinatura recorrente
  — em brainstorming em 2026-08-18.
- Os quatro compromissos de confiança da seção 9 já têm spec e
  implementação: LGPD ([`docs/compliance/lgpd-compliance.md`](compliance/lgpd-compliance.md)),
  auditoria (`backend/db/migrations/0002_audit_log.sql`), backup
  ([`docs/operations/backups.md`](operations/backups.md)) e
  pooling/observabilidade/rate limiting
  ([`docs/operations/reliability.md`](operations/reliability.md)). Cada
  um tem pendências pontuais próprias (nenhuma bloqueia as fases
  seguintes).

---

## Anexo: briefing fundador original

> Reproduzido na íntegra para preservar a fonte primária das decisões acima.

```
Você é meu agente de desenvolvimento para o projeto Montese SST — uma plataforma
SaaS de gestão de Segurança e Saúde do Trabalho (SST) para o mercado brasileiro,
com foco inicial na região Sul de Santa Catarina.

CONTEXTO DO NEGÓCIO
Não é apenas um software de SST. É uma plataforma que conecta três papéis:
empresa cliente (RH), técnico de segurança responsável (remoto) e técnico
parceiro (visitas presenciais). O diferencial competitivo é o atendimento
humano e a rede de técnicos parceiros — não a tecnologia isolada.

ESCOPO DO MVP (nesta ordem, um por vez, com checkpoint formal antes de avançar)
1. Fundação: Docker Compose (Postgres, Redis, backend, frontend, nginx),
   autenticação multi-tenant com roles (empresa, técnico, parceiro, admin),
   Row-Level Security no Postgres desde o início.
2. Site institucional: Home, Planos, Notícias, Contato, Cadastro (CNPJ + e-mail),
   Login.
3. Onboarding: wizard de configuração inicial da empresa após primeiro login.
4. Dashboard Empresa: score de SST, pendências, documentos, agenda.
5. Dashboard Técnico: carteira de clientes, agenda, relatórios de inspeção
   (usar como referência os modelos de relatório que vou anexar).
6. Fluxo de visita presencial + Dashboard Parceiro.
7. Dashboard Admin.
8. Copiloto de IA (relato em campo → relatório estruturado).

REGRAS NÃO-NEGOCIÁVEIS DE ARQUITETURA
- PostgreSQL é o único banco relacional. Multi-tenant via tenant_id +
  Row-Level Security em toda tabela desde o dia 1.
- Documentos (PDFs, fotos, laudos) NUNCA ficam no disco da VPS — vão para
  object storage S3-compatible externo. Confirme isso antes de implementar
  qualquer upload.
- PostgreSQL e Redis nunca expostos publicamente — apenas rede interna Docker.
- Sem IA local (nada de Ollama na VPS de produção) — toda chamada de IA vai
  por API externa.
- Um serviço por container Docker, mesmo rodando tudo numa única VPS
  (facilita separar depois sem reescrever).
- Nada de mock/simulação apresentado como funcional — sempre me mostrar
  output real de terminal/logs, nunca um resumo do que "deveria" ter
  acontecido.

STACK
- Frontend: Next.js (React)
- Backend: [DEFINIR: NestJS ou FastAPI — escolher e justificar antes de
  codificar]
- Banco: PostgreSQL + Redis
- Object storage: S3-compatible (Cloudflare R2)
- Deploy: Docker Compose na VPS (Ubuntu 24.04)

MEU NÍVEL TÉCNICO
Sou o fundador/operador, não sou técnico de infraestrutura no dia a dia.
Preciso que você explique comandos de terminal antes de rodar quando
envolverem risco (deleção, migração de banco, mudança de configuração de
produção), e que sempre me dê o comando exato para eu confirmar o resultado
por mim mesmo.

PRIMEIRO PASSO
Antes de escrever qualquer código: proponha a estrutura de pastas do
repositório, o docker-compose.yml inicial (postgres, redis, backend,
frontend, nginx), e o schema inicial das tabelas core (tenants, users,
employees, technicians, partners) com Row-Level Security. Apresente para
minha aprovação antes de criar os arquivos.
```

> **Nota:** a escolha de NestJS foi implementada no código antes deste
> registro existir e, em 2026-08-18, formalmente confirmada pelo fundador —
> fechando o checkpoint pedido no briefing original acima (ver seção
> "Decisão confirmada" em `docs/roadmap.md`).
