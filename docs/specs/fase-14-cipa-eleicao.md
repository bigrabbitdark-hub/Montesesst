# Fase 14 — Central da CIPA: eleição de representantes

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-02.
> Segunda frente fora do núcleo da CIPA (`docs/specs/fase-12-central-cipa-nucleo.md`
> §1: "frentes futuras, na ordem acordada" — esta é a segunda da lista,
> logo depois da Fase 13, ata por IA, já em produção).

## 1. Objetivo e escopo

A CIPA tem dois tipos de membro por lei (NR-5): representantes do
empregador (indicados pela empresa) e representantes dos empregados
(eleitos por voto secreto). O núcleo da CIPA (Fase 12a/12b) já cobre o
cadastro de membros de qualquer origem, mas hoje a empresa precisa
digitar manualmente cada eleito depois da eleição acontecer. Esta fase
digitaliza o processo administrativo da eleição — candidatos e
resultado — e fecha esse ciclo automaticamente, alimentando o cadastro
de membros já existente sem redigitação.

**A votação em si continua física**, fora do sistema (cédula/urna,
como já acontece hoje nas empresas) — o sistema não conduz nem
substitui a votação, só registra candidatos e resultado depois de
apurados. Ver seção 2 para o porquê disso ser uma decisão fechada, não
uma limitação técnica.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Sem login de colaborador, também nesta fase.** A Fase 12 já fechou
  essa decisão como válida "nesta fase e nas seguintes de CIPA" — quem
  sempre opera é o usuário `empresa`. Isso descarta de saída qualquer
  fluxo de "funcionário vota logando no sistema" (link único, QR code
  etc.) — mesmo sem criar uma conta persistente, isso esbarraria no
  espírito da decisão. **Consequência direta:** a votação em si
  continua 100% física; o sistema só entra depois, para registrar
  candidatos e o resultado já apurado.
- **Escopo raso, não o processo legal inteiro.** A lei prevê várias
  etapas formais (edital de convocação, prazo de inscrição, período de
  votação, apuração, posse) — esta fase cobre só **candidatos +
  resultado final**, sem calendário guiado nem checklist por etapa
  (diferente do gerador de calendário de reuniões da Fase 12a). Se
  virar necessidade real, um calendário guiado de eleição é candidato
  a frente própria futura.
- **Sem geração de ata em PDF.** Diferente da ata de reunião (Fase
  12a), o resultado da eleição fica só como registro na tela — sem
  documento formal gerado. Candidato a frente futura se for pedido.
- **Candidato pode ser um funcionário já cadastrado ou nome livre.**
  A tabela `employees` já existe (`full_name`, `cpf`, `position`,
  `admission_date`, `status`, escopada só por `tenant_id`) — candidato
  vinculado a um `employee_id` reaproveita esse cadastro; candidato sem
  vínculo usa nome livre. Mesma regra de "exatamente um dos dois" já
  usada em `cipa_meeting_participants` (Fase 12a).
- **`employees` não é escopada por estabelecimento** (só por
  `tenant_id` — confirmado lendo a migration `0001_init.sql`), então o
  seletor de candidato lista todos os funcionários do tenant, não só
  os do estabelecimento da eleição. Limitação pré-existente do schema,
  não introduzida por esta fase — aceita como está.
- **A eleição determina só titular/suplente, não presidente/vice/secretário.**
  Esses papéis internos da CIPA continuam sendo escolha manual feita
  depois, na tela de membros já existente (Fase 12a) — a eleição só
  precisa saber quem foi eleito e em que condição (titular ou
  suplente).
- **Uma eleição "aberta" por estabelecimento por vez.** Mesmo padrão
  de "um registro ativo" já usado no rascunho de ata por IA (Fase 13).

## 3. Modelo de dados

Duas tabelas novas, seguindo os padrões já estabelecidos no módulo
CIPA (RLS mirando `cipa_meetings_isolation`, trigger de
`updated_at`):

```sql
CREATE TABLE cipa_elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  data_eleicao DATE,
  -- cipa_members.inicio_mandato/fim_mandato são NOT NULL (Fase 12a) — a
  -- eleição precisa capturar o período do mandato pra poder alimentar
  -- os membros ao concluir (seção 4). Mesmo padrão já usado em
  -- cipa_committees (data_inicio/data_termino pedidos na criação).
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'concluida')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Índice parcial: no máximo 1 eleição 'aberta' por estabelecimento por vez.
CREATE UNIQUE INDEX cipa_elections_one_open_per_unit
  ON cipa_elections (company_unit_id) WHERE status = 'aberta';

CREATE TABLE cipa_election_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES cipa_elections(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  nome_livre TEXT,
  votos INT,
  eleito BOOLEAN NOT NULL DEFAULT false,
  titular_suplente TEXT CHECK (titular_suplente IN ('titular', 'suplente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_candidate_source CHECK (
    (employee_id IS NOT NULL AND nome_livre IS NULL)
    OR (employee_id IS NULL AND nome_livre IS NOT NULL)
  )
);
```

Ambas com RLS espelhando `cipa_meetings_isolation`/`cipa_meeting_ata_drafts_isolation`
(tenant direto em `cipa_elections`; `cipa_election_candidates` via
`EXISTS` contra `cipa_elections`, mesmo padrão de
`cipa_meeting_participants`).

## 4. Fluxo

1. `POST /cipa/elections` — cria a eleição (`ano`, `data_eleicao`
   opcional, `inicio_mandato`/`fim_mandato` obrigatórios) para o
   estabelecimento selecionado. Rejeita com 409 se já
   existe uma eleição `aberta` para o mesmo `company_unit_id` —
   checagem em duas camadas: uma checagem de aplicação antes do
   `INSERT` (`SELECT ... WHERE company_unit_id = $1 AND status =
   'aberta' FOR UPDATE`, mesmo estilo de guarda já usado no rascunho de
   ata por IA da Fase 13, sem o componente de "idade" de lá — aqui não
   há processamento em segundo plano, então não existe uma eleição
   "aberta" ficar órfã por reinício de servidor, só por decisão da
   própria empresa de não concluir ainda) pra devolver um 409 com
   mensagem clara, com o índice único parcial da seção 3 como rede de
   segurança contra corrida de verdade (duas requisições quase
   simultâneas).
2. `POST /cipa/elections/:id/candidates` — adiciona candidato
   (`employee_id` OU `nome_livre`). Editável livremente enquanto a
   eleição está `aberta`.
3. Depois da votação física, empresa volta a cada candidato e
   preenche `votos` + marca `eleito`/`titular_suplente` via `PATCH
   /cipa/elections/:id/candidates/:candidateId`. **`eleito = true`
   exige `titular_suplente` preenchido** — o PATCH rejeita com 400 se
   vier `eleito: true` sem `titular_suplente` (marcar alguém eleito sem
   dizer titular ou suplente não é um estado válido); marcar
   `eleito: false` limpa `titular_suplente` de volta pra `null`.
4. `POST /cipa/elections/:id/concluir` — valida que todo candidato com
   `eleito = true` tem `titular_suplente` preenchido (defesa em
   profundidade — o PATCH do passo 3 já deveria garantir isso, mas
   concluir não confia cegamente num estado que pode ter sido montado
   por chamadas de API fora de ordem). Trava a eleição
   (`status: 'concluida'`) e, numa única transação, cria uma linha em
   `cipa_members` para cada candidato com `eleito = true`:
   `representacao: 'empregados'`, `titular_suplente` conforme
   marcado, `funcao_cipa: 'membro'` (ajustável depois na tela de
   membros já existente), `nome` = nome do funcionário vinculado ou
   `nome_livre`, `company_unit_id` da eleição, `inicio_mandato`/
   `fim_mandato` = os mesmos da eleição (seção 3). Rejeita com 409 se a
   eleição já estiver `concluida` (mesmo padrão de trava de
   `aprovar-ata`/`reabrir-ata`).
5. Eleição `concluida` fica só leitura — sem rota de reabertura nesta
   fase (diferente da ata, que tem `reabrir-ata`; se virar necessidade
   real, entra depois).

## 5. Frontend

Página nova `/empresa/cipa/eleicao`, mesmo padrão das outras telas da
Central da CIPA (fetch direto, sem cliente de API centralizado — YAGNI
já decidido nas fases anteriores). Link novo "🗳️ Eleição" no grupo
CIPA da sidebar (`EmpresaSidebar.tsx`), entre "Membros" e
"Pendências".

- Sem eleição aberta: CTA "Criar eleição" (ano, data da votação
  opcional, início e fim do mandato obrigatórios).
- Eleição aberta: lista de candidatos + formulário de adicionar
  (select de funcionário cadastrado OU campo de nome livre, mesmo
  padrão já usado no formulário de participante da tela de reunião).
  Cada candidato tem campos de votos + checkbox eleito + seletor
  titular/suplente (habilitados a qualquer momento, não só depois de
  "apuração" formal — a empresa preenche quando tiver o resultado em
  mãos).
- Botão "Concluir eleição", com confirmação (`window.confirm`, mesmo
  padrão de "Aprovar ata") — irreversível nesta fase, deixa isso claro
  no texto de confirmação.
- Eleição concluída: lista somente-leitura dos candidatos e do
  resultado, sem formulário de edição.

## 6. Testes

Mesmo padrão de todo o projeto: backend com suíte e2e real (Postgres
real, sem mock de banco) cobrindo criar eleição, guarda de "só uma
aberta por estabelecimento", adicionar candidato com `employee_id` e
com `nome_livre` (e rejeitar os dois/nenhum), registrar
votos/eleito/titular-suplente (incluindo rejeitar `eleito: true` sem
`titular_suplente` com 400), concluir eleição e confirmar que os
`cipa_members` corretos foram criados (nome, representação,
titular/suplente corretos), rejeitar edição após concluída. Frontend
sem suíte automatizada (estado real do projeto) — Playwright com
sessão sintética + mock de rota, contra a build de produção real.

## 7. Fora de escopo desta fase

- Conduzir a votação em si dentro do sistema (login de funcionário,
  cédula digital, urna eletrônica) — decisão fechada, ver seção 2.
- Calendário guiado com etapas do processo legal (edital, inscrição,
  apuração, posse) — só candidatos + resultado final.
- Geração de ata de eleição em PDF.
- Reabrir uma eleição já concluída.
- Atribuir automaticamente presidente/vice-presidente/secretário —
  continua manual, na tela de membros já existente.
