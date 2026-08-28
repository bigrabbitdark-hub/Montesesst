# Fase 9 — RAG Normativo (Assistente Montese SST)

> Spec aprovada por brainstorming em chat com o fundador em 2026-08-28.
> Primeiro sub-projeto da frente "Agentes + IA" (ver `docs/vision.md` e
> `docs/roadmap.md` — Fase 8 fechou o Copiloto de relato; esta é a
> segunda integração de IA do sistema, a primeira com busca por
> similaridade). Referência viva desta decomposição:
> `docs/specs/fase-8-copiloto-ia.md` deixou registrada a pendência
> "Política de Funcionamento dos Agentes Especializados" — esta spec é o
> primeiro passo concreto que endereça essa pendência.

## 1. Objetivo e escopo

O fundador trouxe uma visão ampla de agentes de IA (orquestrador,
agente operacional, RAG normativo, copiloto do técnico, agente de
inspeção, secretário do técnico, pendências inteligentes, atualização
normativa, verificador). Essa visão foi decomposta em sub-projetos
independentes (cada um com seu próprio ciclo spec → plano →
implementação). Esta spec cobre **apenas o primeiro**: uma base de
conhecimento sobre normas oficiais de SST, consultável em linguagem
natural pela empresa e pelo técnico/parceiro, com resposta sempre
ancorada em fonte oficial vigente.

**Regra central, não-negociável** (citada literalmente pelo fundador):
**sem fonte oficial, sem afirmação normativa.** Nenhuma resposta pode
afirmar algo sobre uma norma sem apontar o trecho oficial que sustenta
a afirmação.

**Fora de escopo desta spec** (sub-projetos futuros, cada um com sua
própria spec quando chegar a vez):
- Agente Orquestrador com roteamento real entre múltiplos agentes —
  nesta fase só existe um agente, então toda pergunta do Assistente
  vai direto pro RAG Normativo. Roteamento de verdade só faz sentido
  desenhar quando existir mais de um agente pra rotear.
- Agente Operacional (consulta dados da própria empresa: pendências,
  funcionários, EPIs).
- Agente de atualização de cadastro via upload de documentos do
  cliente (a ideia do "botão de consulta" que também atualiza dados —
  arquiteturalmente separada desta spec: aqui a base é compartilhada e
  sem RLS; aquele agente escreve dentro do tenant do cliente).
- Copiloto do técnico ("Meu dia"), Agente de inspeção por
  voz/texto livre, Secretário do técnico, Agente de pendências
  inteligentes, notificação por WhatsApp.
- Monitoramento do Diário Oficial da União (avaliado e descartado
  nesta primeira versão — fontes oficiais diretas de cada entidade
  bastam pra começar).

## 2. Modelo de dados

Três tabelas novas. **Sem `tenant_id` e sem RLS** — esta base é
compartilhada entre todos os clientes, mesma categoria de
`epi_catalog_items` (catálogo global, hoje sem RLS, controle de acesso
só via `@Roles()` no controller).

```sql
CREATE TABLE official_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,           -- 'MTE', 'Fundacentro', etc.
  code text,                      -- 'NR-06' quando aplicável; NULL pra guias sem código
  title text NOT NULL,
  official_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE normative_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES official_sources(id),
  status text NOT NULL DEFAULT 'aguardando_validacao'
    CHECK (status IN ('aguardando_validacao', 'vigente', 'rejeitado', 'substituido')),
  content_hash text NOT NULL,     -- sha256 do raw_text, usado pro monitor detectar mudança
  file_key text NOT NULL,         -- PDF/HTML bruto no R2 (nunca disco — mesma regra de `documents`)
  file_name text NOT NULL,
  mime_type text NOT NULL,
  raw_text text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  supersedes_document_id uuid REFERENCES normative_documents(id),
  indexed_at timestamptz,         -- preenchido só quando TODOS os chunks foram indexados com sucesso
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Só uma versão vigente por fonte ao mesmo tempo (mesmo padrão da
-- migration 0019, matriz de company_units)
CREATE UNIQUE INDEX normative_documents_one_vigente_per_source
  ON normative_documents(source_id) WHERE status = 'vigente';

CREATE TABLE normative_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES normative_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),         -- dimensão do modelo de embedding escolhido (seção 3)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX normative_document_chunks_embedding_idx
  ON normative_document_chunks USING hnsw (embedding vector_cosine_ops);
```

Um documento `vigente` só é considerado pesquisável de fato quando
`indexed_at IS NOT NULL` — a aprovação (`status = 'vigente'`) e a
indexação completa (`indexed_at`) são passos distintos (ver seção 4.3,
tratamento de falha na indexação). A busca do Assistente sempre filtra
`normative_documents.status = 'vigente' AND indexed_at IS NOT NULL`.

## 3. Infraestrutura: pgvector

O Postgres de produção roda `postgres:16-alpine`, sem a extensão
`vector`. Troca confirmada pelo fundador em chat (2026-08-28): imagem
passa a ser `pgvector/pgvector:pg16` — mantida pelo próprio projeto
pgvector, construída sobre o mesmo Postgres 16, mesmo formato de dado,
volume existente permanece intacto. A troca em si:

```bash
# docker-compose.yml: postgres.image: postgres:16-alpine -> pgvector/pgvector:pg16
docker compose pull postgres
docker compose up -d postgres
```

seguida de uma migration `CREATE EXTENSION IF NOT EXISTS vector;`.
Poucos segundos de indisponibilidade, mesmo padrão de qualquer restart
de serviço já feito neste projeto.

**Embeddings e geração de resposta:** ambos via OpenRouter (mesmo
provedor e mesma chave já ativos desde a Fase 8 — `OPENROUTER_API_KEY`).
OpenRouter expõe `/api/v1/embeddings` desde 2026, compatível com o
formato OpenAI. Modelo proposto: `openai/text-embedding-3-small`
(1536 dimensões, custo baixo, qualidade suficiente pra busca de
trechos normativos) — configurável via `OPENROUTER_EMBEDDING_MODEL`,
mesmo padrão de `OPENROUTER_MODEL`.

**Extração de texto de PDF:** os documentos oficiais em geral são PDF.
Não existe nenhuma lib de extração de texto de PDF neste backend hoje
(o Copiloto de relato trabalha em cima de `report_text` já digitado,
nunca de arquivo). Adiciona `pdf-parse` (lib madura, MIT, sem
dependência nativa pesada) como dependência nova do backend.

## 4. Backend

### 4.1 Fontes monitoradas

`official_sources` começa com um conjunto curado manualmente pelo
fundador/admin (as ~38 NRs do MTE + guias da Fundacentro relevantes),
cadastradas via endpoint admin — não há descoberta automática de
fontes, só monitoramento das fontes já cadastradas.

- `POST /normative-sources` (`@Roles('admin')`) — cadastra fonte nova.
- `GET /normative-sources` (`@Roles('admin')`) — lista.

### 4.2 Monitor (detecção de mudança)

Job agendado dentro do próprio processo backend via `@nestjs/schedule`
(`@Cron`) — sem container novo, sem cron externo, consistente com "um
serviço por container Docker" já usado neste projeto pra tudo que não
precisa de infraestrutura própria. Roda 1x por dia.

Para cada `official_source` ativa:
1. Busca `official_url` (HTTP GET, timeout curto).
2. Se PDF: extrai texto via `pdf-parse`. Se HTML: extrai texto visível.
3. Calcula `sha256` do texto extraído.
4. Compara com o `content_hash` do `normative_document` `vigente` mais
   recente dessa fonte (se existir).
5. Hash igual → nada a fazer. Hash diferente (ou nenhum documento
   vigente ainda) → salva o arquivo bruto no R2, cria um
   `normative_document` novo com `status = 'aguardando_validacao'`.
6. Falha de rede/timeout numa fonte → loga o erro e segue pras
   próximas fontes; não interrompe o job inteiro.

O monitor **nunca** muda `status` pra `vigente` sozinho — só cria a
linha `aguardando_validacao`. Publicação é sempre decisão humana
(seção 4.3).

### 4.3 Validação humana e indexação

- `GET /normative-documents?status=aguardando_validacao`
  (`@Roles('admin')`) — fila de revisão.
- `GET /normative-documents/:id` (`@Roles('admin')`) — detalhe, com o
  texto da versão anterior (`supersedes_document_id`) junto pra diff
  visual no frontend.
- `POST /normative-documents/:id/approve` (`@Roles('admin')`):
  1. Marca a versão vigente anterior da mesma fonte (se existir) como
     `substituido`, define `supersedes_document_id`.
  2. Marca esta como `vigente`, `reviewed_by_user_id`, `reviewed_at`.
  3. Dispara a indexação: fatia `raw_text` em pedaços de ~500 tokens
     com 50 tokens de sobreposição entre pedaços consecutivos, gera
     embedding de cada pedaço via OpenRouter, insere em
     `normative_document_chunks`.
  4. Só depois que **todos** os pedaços foram inseridos com sucesso,
     grava `indexed_at = now()`. Se a indexação falhar no meio, o
     documento fica `vigente` porém com `indexed_at IS NULL` — a busca
     não o enxerga (não é pesquisável), e o admin vê esse estado
     explicitamente na tela ("aprovado, indexação pendente") em vez de
     um buraco silencioso na base. Reprocessar a indexação é uma ação
     manual disponível nessa mesma tela.
- `POST /normative-documents/:id/reject` (`@Roles('admin')`,
  `{ reason: string }`) — marca `rejeitado`, guarda o motivo.

### 4.4 Consulta (Assistente) e Verificador

`POST /assistant/normative-query` (`@Roles('empresa', 'tecnico', 'parceiro')`),
`{ question: string }` (com `@MaxLength`, mesmo padrão do
`ai-draft.dto.ts` da Fase 8):

1. Gera embedding da pergunta (OpenRouter).
2. Busca os top-k (k=6) `normative_document_chunks` mais próximos por
   similaridade de cosseno, restrito a documentos
   `status = 'vigente' AND indexed_at IS NOT NULL`.
3. Zero resultados com similaridade de cosseno acima de 0.75 (limiar
   configurável via `OPENROUTER_RAG_MIN_SIMILARITY`, default `0.75`) →
   responde direto `{ answer: null, message: "Não encontrei uma norma
   vigente na base que trate disso." }`, sem chamar o modelo de chat.
4. Caso contrário, chama o modelo de chat (mesmo `OPENROUTER_MODEL` da
   Fase 8) com os pedaços recuperados como contexto, forçando saída
   estruturada via tool-schema (mesmo padrão de
   `checklist-extraction-shared.ts`): uma lista de
   `{ claim: string, chunk_ids: string[] }`.
5. **Verificador** (determinístico, sem chamada de IA extra): para
   cada item da lista, confere se todo `chunk_id` citado (a) estava de
   fato no conjunto recuperado no passo 2 e (b) pertence a um
   documento `vigente`. Item com `chunk_ids` vazio ou citando algo
   fora do conjunto recuperado é descartado inteiro.
6. Nenhum item sobrevive à verificação → mesma mensagem de fallback do
   passo 3.
7. Resposta final = concatenação das `claim`s que sobreviveram +
   lista de citações (título da fonte + `official_url` de cada
   `chunk_id` usado), devolvida ao frontend.

OpenRouter fora do ar → mesma mensagem de indisponibilidade já usada
pelo Copiloto de relato (Fase 8).

Nenhuma escrita no banco além da leitura de chunks — endpoint
stateless, mesmo espírito do `POST /inspections/:id/ai-draft`.

## 5. Frontend

**Admin** — tela nova "Base normativa" (`/admin/normativa`, adicionada
ao `AdminSidebar`): lista de fontes monitoradas; fila de
`aguardando_validacao` com diff contra a versão anterior; botões
Aprovar/Rejeitar; indicador visual pra documentos `vigente` com
indexação pendente.

**Empresa e técnico** — "Assistente Montese SST": caixa de pergunta +
resposta em texto, citações como links clicáveis pro documento oficial
(abre o PDF/HTML original salvo no R2). Nesta primeira versão, sem
histórico de conversa persistido, sem streaming — pergunta, espera,
resposta. Aviso fixo abaixo da resposta, reaproveitando o texto já
usado no Copiloto de relato: a IA não substitui a avaliação de um
profissional legalmente habilitado.

Entrada: um item novo no `EmpresaSidebar` ("Assistente"). Técnico e
parceiro ainda não têm sidebar própria (só o rodapé adicionado
recentemente) — o link entra como uma página acessível, sem redesenhar
a navegação do técnico agora (isso é outro sub-projeto: "Sistema do
técnico").

## 6. Testes

Mesma disciplina de todo o projeto: Postgres/Redis reais, e2e via
`supertest`, sem mock de banco. A chamada de IA paga é a única
substituída em teste automatizado (`overrideProvider`), com validação
manual contra a API real antes de fechar a spec como implementada
(mesmo padrão da Fase 8, seção 7).

- Monitor: hash de dois textos diferentes → detecta mudança; hash
  igual → não cria documento novo; falha de fetch numa fonte não
  impede as demais.
- Aprovação: fluxo completo com um provider de embedding falso
  (determinístico) — aprova, confere `indexed_at` preenchido, confere
  versão anterior virou `substituido`, confere unicidade de `vigente`
  por fonte.
- Busca por similaridade: insere vetores conhecidos direto via SQL
  (sem gastar embedding real), confere ordenação por proximidade.
- Verificador: dado um conjunto de chunks recuperados e uma resposta
  estruturada simulada, confere que claims com `chunk_id` inválido são
  descartadas e que claims válidas sobrevivem.
- `POST /assistant/normative-query`: 403 pra admin (não é usuário
  final do RAG), zero resultados → mensagem de fallback sem chamar o
  modelo de chat, resultado com citações válidas.

## 7. Decisões confirmadas (brainstorming em chat, 2026-08-28)

- Sub-projeto único: RAG Normativo primeiro, separado do agente de
  atualização de cadastro via upload (modelos de segurança diferentes
  — base compartilhada sem RLS vs. escrita dentro do tenant).
- Monitoramento automático das fontes oficiais (não só upload manual)
  — mas a publicação de qualquer atualização exige validação humana
  antes de entrar na base pesquisável, sem exceção.
- Fontes na primeira versão: NRs (MTE) + Fundacentro + outras
  entidades quando fizer sentido (não restrito só às NRs). DOU avaliado
  e descartado por ora.
- Acesso ao Assistente: empresa e técnico/parceiro. Admin fica de fora
  como usuário final (tem a tela de validação, não o chat).
- pgvector no Postgres existente (troca de imagem pra
  `pgvector/pgvector:pg16`), não um banco de vetores externo novo.
- Verificador determinístico (checagem de código contra os chunks
  realmente recuperados), não uma segunda chamada de IA "se
  autoconferindo".

## 8. Pendências

- [ ] Lista inicial curada de fontes (`official_sources`) — cadastro
  manual das ~38 NRs + guias da Fundacentro relevantes fica pra
  execução do plano, não faz parte desta spec de arquitetura.
- [ ] Atualizar `docs/compliance/matriz-conformidade.md` (categoria G,
  "Política de Funcionamento dos Agentes Especializados") quando esta
  fase for implementada — o texto formal e público sobre limites dos
  agentes deve nascer junto com o primeiro agente que responde pergunta
  normativa de verdade, não depois.
- [ ] Custo por consulta (embedding da pergunta + chamada de chat) —
  medir com exemplos reais antes de liberar em produção, mesmo
  processo da Fase 8 seção 7.
- [ ] Definir o texto exato do aviso de limite de responsabilidade
  profissional exibido junto de cada resposta do Assistente — reusa o
  espírito do aviso já usado no Copiloto, texto final fica pra
  implementação.
