# Fase 15 — Central da CIPA: Capacitação (Treinamentos, DDS, SIPAT)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-03.
> Terceira frente fora do núcleo da CIPA (`docs/specs/fase-12-central-cipa-nucleo.md`
> §1: "frentes futuras, na ordem acordada" — esta é a terceira da lista,
> logo depois da Fase 14, eleição de representantes, já em produção).
> O item do roadmap agrupa três temas numa frase só ("Treinamentos, DDS
> (módulo completo), SIPAT") — mantidos juntos nesta spec por decisão
> do fundador, cada um com seu próprio modelo de dados e fluxo, unidos
> só pela navegação.

## 1. Objetivo e escopo

Três frentes de "educação/conscientização em segurança" que hoje são
pontas soltas no sistema:

- **Treinamentos** — hoje só existe uma categoria genérica de upload
  de documento (`category = 'treinamento'`, sem dono, sem validade,
  sem reciclagem). Vira controle real: quem fez qual treinamento
  obrigatório de NR, quando, até quando vale, com certificado opcional
  anexado.
- **DDS (Diálogo Diário de Segurança)** — hoje existem só 2 campos
  (`dds_topic`, contagem de participantes) dentro do relatório de
  inspeção do técnico (`docs/specs/fase-6-inspecoes.md`). Vira um
  registro próprio da empresa, independente de visita técnica — a
  empresa documenta os DDS que conduz no dia a dia.
- **SIPAT (Semana Interna de Prevenção de Acidentes)** — não existe
  hoje. Vira uma "edição" anual por estabelecimento com atividades
  planejadas e marcadas como realizadas.

As três entram sob uma casa única na navegação da Central da CIPA
("🎓 Capacitação", com 3 abas internas), mas são independentes por
baixo — tabelas, rotas e regras de negócio próprias, sem acoplamento
técnico entre si.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Sem login de colaborador, também nesta fase** (decisão da Fase 12,
  válida "nesta fase e nas seguintes de CIPA") — quem sempre opera é o
  usuário `empresa`.
- **Treinamentos cobre qualquer NR, qualquer funcionário** — não é
  restrito aos membros já cadastrados da CIPA (`cipa_members`). É um
  controle de compliance geral da empresa, só mora dentro da Central
  da CIPA por enquanto (mesma tela/módulo), não por escopo de dado.
- **Catálogo de tipos de treinamento é fixo no código**, com validade
  padrão sugerida por tipo (sempre editável antes de salvar) — não é
  uma tabela gerenciável pela empresa nesta fase. Ver seção 3 pra
  lista completa.
- **Certificado é opcional, anexado via R2** (mesma infraestrutura já
  ativa do módulo de documentos — diferente do `GROQ_API_KEY`, o R2
  já está configurado e funcionando em produção hoje).
- **Reciclagem não é uma ação especial** — fazer o treinamento de novo
  é só criar um novo registro pro mesmo funcionário+tipo. O histórico
  completo fica visível; o vencimento considerado é sempre o do
  registro mais recente daquele tipo.
- **Pendência de treinamento é calculada na hora, não é uma linha
  gravável** — evita precisar de um scheduler/job novo (mesma linha de
  decisão já tomada na Fase 13 de evitar fila de jobs). `GET
  /cipa/pendencias` passa a mesclar as pendências manuais de sempre
  com pendências computadas a partir de `cipa_trainings` vencidas/a
  vencer. DDS e SIPAT não geram pendência automática nesta fase.
- **DDS registra só contagem de participantes, não lista nomeada** —
  mesmo nível de detalhe que já existe hoje no campo embutido na
  inspeção. Alta frequência (diário/semanal) torna lista nomeada
  fricção alta pra pouco ganho.
- **DDS não tem vínculo obrigatório com inspeção do técnico** — é um
  registro próprio e independente da empresa. O campo já existente
  dentro do relatório de inspeção não é alterado nesta fase.
- **SIPAT planeja e registra atividades**, não é só uma confirmação de
  que aconteceu — uma edição por ano/estabelecimento, com lista de
  atividades que a empresa marca como realizada conforme a semana
  avança.
- **Sem mapeamento automático "cargo → treinamento obrigatório"** — a
  empresa escolhe manualmente o tipo pra cada funcionário. Automação
  por cargo é candidata a frente própria futura, se virar necessidade
  real.
- **Sem notificação por e-mail/WhatsApp de vencimento** — o alerta
  aparece só dentro do sistema, na lista de pendências.
- **Sem "encerrar edição" de SIPAT** — cada atividade tem seu próprio
  `status`; não existe um estado de edição travada/somente-leitura
  nesta fase (diferente da eleição, que trava ao concluir).

## 3. Modelo de dados

Quatro tabelas novas, seguindo os padrões já estabelecidos no módulo
CIPA (RLS mirando `cipa_meetings_isolation`/`cipa_election_candidates_isolation`
conforme o caso, trigger de `updated_at`).

### 3.1 Treinamentos

```sql
CREATE TABLE cipa_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- RESTRICT, não SET NULL nem CASCADE — mesma lição já aprendida na
  -- revisão final da Fase 14 (cipa_election_candidates.employee_id):
  -- histórico de treinamento é registro de compliance NR, deve
  -- sobreviver mesmo se o funcionário for desligado/apagado depois.
  -- Apagar um funcionário com histórico de treinamento passa a
  -- exigir tratamento explícito no service (mesmo padrão de
  -- EmployeesService.remove/EpiService.remove já usado pra
  -- employee_epi_deliveries).
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  -- Preenchido só quando tipo = 'outro'; NULL nos demais casos.
  tipo_outro TEXT,
  data_realizacao DATE NOT NULL,
  -- Sugerida automaticamente a partir da tabela de validade padrão
  -- por tipo (ver abaixo), sempre editável antes de salvar. Guardada
  -- como valor final, não recalculada depois.
  data_validade DATE NOT NULL,
  carga_horaria INT,
  -- Referência ao objeto no R2 (mesmo padrão de documents.file_key),
  -- NULL quando não há certificado anexado.
  certificado_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tipo_outro CHECK (
    (tipo = 'outro' AND tipo_outro IS NOT NULL)
    OR (tipo != 'outro' AND tipo_outro IS NULL)
  )
);
CREATE TRIGGER trg_cipa_trainings_updated_at BEFORE UPDATE ON cipa_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_trainings_employee_idx ON cipa_trainings (employee_id);
CREATE INDEX cipa_trainings_validade_idx ON cipa_trainings (data_validade);

ALTER TABLE cipa_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_trainings FORCE ROW LEVEL SECURITY;
-- Tenant_id direto, mesmo padrão de cipa_elections_isolation.
CREATE POLICY cipa_trainings_isolation ON cipa_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_trainings.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_trainings.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

**Catálogo de tipos e validade padrão sugerida** (constante no backend,
não em tabela — decisão da seção 2), valores de referência, sempre
editáveis pela empresa antes de salvar:

| Tipo | Descrição | Validade sugerida |
|---|---|---|
| `nr-05` | Membro da CIPA | 24 meses |
| `nr-06` | Uso de EPI | 12 meses |
| `nr-10` | Segurança em eletricidade | 24 meses |
| `nr-11` | Transporte/movimentação de materiais (ex. operador de empilhadeira) | 12 meses |
| `nr-12` | Segurança em máquinas e equipamentos | 24 meses |
| `nr-18` | Condições de segurança na construção civil | 12 meses |
| `nr-20` | Inflamáveis e combustíveis | 12 meses |
| `nr-33` | Espaço confinado | 12 meses |
| `nr-35` | Trabalho em altura | 24 meses |
| `outro` | Qualquer outro treinamento (nome livre em `tipo_outro`) | sem sugestão — empresa digita a data |

### 3.2 DDS

```sql
CREATE TABLE cipa_dds_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tema TEXT NOT NULL,
  numero_participantes INT,
  responsavel TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_dds_records_updated_at BEFORE UPDATE ON cipa_dds_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_dds_records_company_unit_idx ON cipa_dds_records (company_unit_id);

ALTER TABLE cipa_dds_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_dds_records FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_dds_records_isolation ON cipa_dds_records USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_dds_records.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_dds_records.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

### 3.3 SIPAT

```sql
CREATE TABLE cipa_sipat_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  tema TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_editions_updated_at BEFORE UPDATE ON cipa_sipat_editions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Não faz sentido duas edições de SIPAT no mesmo ano pro mesmo
-- estabelecimento.
CREATE UNIQUE INDEX cipa_sipat_editions_unit_year
  ON cipa_sipat_editions (company_unit_id, ano);

ALTER TABLE cipa_sipat_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_editions FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_sipat_editions_isolation ON cipa_sipat_editions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_sipat_editions.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_sipat_editions.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_sipat_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES cipa_sipat_editions(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  titulo TEXT NOT NULL,
  responsavel TEXT,
  publico_alvo TEXT,
  status TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'realizada', 'cancelada')),
  numero_participantes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_activities_updated_at BEFORE UPDATE ON cipa_sipat_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_sipat_activities_edition_idx ON cipa_sipat_activities (edition_id);

ALTER TABLE cipa_sipat_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_activities FORCE ROW LEVEL SECURITY;
-- Mesmo padrão de cipa_election_candidates_isolation — sem tenant_id
-- próprio, isolamento via EXISTS contra cipa_sipat_editions (que já
-- tem sua própria RLS, então a composição escopa corretamente).
CREATE POLICY cipa_sipat_activities_isolation ON cipa_sipat_activities USING (
  EXISTS (SELECT 1 FROM cipa_sipat_editions e WHERE e.id = cipa_sipat_activities.edition_id)
);
```

## 4. Fluxo

### 4.1 Treinamentos

1. `POST /cipa/trainings` — multipart, mesmo padrão de
   `DocumentsController.upload` (`FileInterceptor`), mas com o arquivo
   opcional (`DocumentsController` exige arquivo; aqui não — cria
   normalmente sem `certificado_key` se nada for anexado). Campos:
   `employee_id`, `tipo`, `tipo_outro` se `tipo = 'outro'`,
   `data_realizacao`, `data_validade` (o frontend pré-preenche
   sugerindo `data_realizacao + validade padrão do tipo`, mas o valor
   final enviado é sempre o que estiver no campo, editado ou não),
   `carga_horaria` opcional, e o arquivo `certificado` opcional — se
   presente, grava no R2 (mesmo client já usado por
   `DocumentsService.upload`) e preenche `certificado_key` no mesmo
   INSERT, sem uma segunda chamada.
2. `GET /cipa/trainings?employee_id=&tipo=&status=` — lista com
   filtros. `status` (`valido`/`vencendo`/`vencido`) é calculado na
   query (comparando `data_validade` contra `now()` e uma janela de
   60 dias), não é uma coluna.
3. `GET /cipa/trainings/:id/certificado` — URL assinada do R2 pra
   download, mesmo padrão de `DocumentsController.download`.
4. Sem `PATCH`/`PUT` nesta fase — um registro de treinamento não é
   editado depois de criado (é um fato histórico: "fulano fez X em
   tal data"); corrigir um erro de digitação exige apagar e recriar.
   `DELETE /cipa/trainings/:id` existe pra esse caso.

### 4.2 DDS

1. `POST /cipa/dds` — cria um registro (`company_unit_id`, `data`,
   `tema`, `numero_participantes` opcional, `responsavel` opcional,
   `observacoes` opcional).
2. `GET /cipa/dds?company_unit_id=` — lista cronológica, mais recente
   primeiro.
3. `DELETE /cipa/dds/:id` — remove um registro criado por engano. Sem
   edição nesta fase, mesmo raciocínio de treinamentos (registro de
   um fato pontual).

### 4.3 SIPAT

1. `POST /cipa/sipat/editions` — cria a edição do ano
   (`company_unit_id`, `ano`, `periodo_inicio`, `periodo_fim`, `tema`
   opcional). Rejeita com 409 se já existe uma edição pro mesmo
   `company_unit_id`+`ano` (índice único da seção 3.3 como backstop,
   checagem de aplicação como caminho principal de erro claro, mesmo
   padrão de "uma eleição aberta por estabelecimento" da Fase 14).
2. `GET /cipa/sipat/editions?company_unit_id=` — lista as edições
   (histórico de anos anteriores incluído).
3. `POST /cipa/sipat/editions/:id/activities` — adiciona atividade
   (`data`, `titulo`, `responsavel` opcional, `publico_alvo`
   opcional).
4. `PATCH /cipa/sipat/editions/:id/activities/:activityId` — atualiza
   `status` (`planejada`/`realizada`/`cancelada`) e
   `numero_participantes` (preenchido tipicamente ao marcar como
   `realizada`, mas não obrigatório).
5. `GET /cipa/sipat/editions/:id/activities` — lista as atividades da
   edição.
6. `DELETE /cipa/sipat/editions/:id` — apaga uma edição criada por
   engano (ex. ano errado digitado). Cascateia pras atividades dela
   (FK `ON DELETE CASCADE`, seção 3.3) — aceitável porque não existe
   nenhum outro dado dependente de uma edição de SIPAT (diferente de
   um candidato de eleição, que ao ser concluída já virou membro
   permanente da CIPA). Existe justamente pra evitar o mesmo tipo de
   "erro de digitação sem conserto" encontrado na revisão final da
   Fase 14 (índice único de ano/estabelecimento sem via de correção
   deixaria a empresa travada até o próximo ano).

### 4.4 Pendências computadas

`GET /cipa/pendencias` (endpoint já existente, `PendenciasController`)
passa a mesclar dois conjuntos:

- As linhas reais de `cipa_pendencias`, como já funciona hoje.
- Itens computados a partir de `cipa_trainings`: para cada
  treinamento cujo `data_validade` já passou ou está a até 60 dias de
  passar, um item sintético com `origem: 'treinamento'` (campo novo
  que distingue do resto — os itens computados não têm `id` de banco
  real, não aceitam `PATCH`, não têm `responsavel_user_id`), descrição
  automática (ex. "NR-35 de {nome do funcionário} vence em {N} dias" /
  "venceu há {N} dias"), `prioridade` automática (`alta` se vencido,
  `media` se vencendo), sem `status` editável (desaparece sozinho
  quando um novo registro de treinamento do mesmo funcionário+tipo
  estende a validade).

DDS e SIPAT não entram nesse merge nesta fase.

## 5. Frontend

Link novo "🎓 Capacitação" na sidebar da CIPA (`EmpresaSidebar.tsx`),
depois de "Pendências" (última posição do grupo CIPA hoje). Abre
`/empresa/cipa/capacitacao`, uma página com 3 abas internas
(Treinamentos | DDS | SIPAT) — navegação compartilhada, dados e
chamadas de API totalmente independentes por aba.

- **Aba Treinamentos:** lista filtrável (funcionário, tipo, status
  com badge colorido vencido/vencendo/válido), formulário de novo
  registro (seletor de funcionário — mesmo componente já usado no
  formulário de candidato da eleição —, seletor de tipo com validade
  sugerida preenchendo automaticamente a data de validade ao escolher,
  campo de nome livre quando tipo = "outro", upload opcional de
  certificado). Link de download do certificado quando existir.
- **Aba DDS:** lista cronológica + formulário simples de novo
  registro.
- **Aba SIPAT:** seletor de edição/ano (com CTA de criar uma nova
  edição se o ano corrente ainda não tem uma), lista de atividades da
  edição selecionada com formulário de adicionar atividade e
  controles inline de status/participantes.
- **Pendências:** a tela já existente de pendências (`/empresa/cipa/pendencias`)
  passa a mostrar os itens computados de treinamento junto com as
  pendências manuais, visualmente distinguíveis (ex. badge "treinamento"
  e sem os controles de edição que as pendências manuais têm).

## 6. Testes

Mesmo padrão de todo o projeto: backend com suíte e2e real (Postgres
real, sem mock de banco) cobrindo os CRUDs das 4 tabelas novas,
a restrição de "uma edição de SIPAT por estabelecimento/ano", o
`chk_tipo_outro` (rejeitar `tipo='outro'` sem `tipo_outro` e
`tipo != 'outro'` com `tipo_outro` preenchido), a mescla de pendências
computadas (treinamento vencido aparece com os campos certos,
treinamento válido não aparece, um novo registro do mesmo
funcionário+tipo faz o item computado anterior sumir), e o
`ON DELETE RESTRICT` de `cipa_trainings.employee_id` (apagar um
funcionário com histórico de treinamento deve ser bloqueado com uma
mensagem clara, mesmo padrão já usado em `EmployeesService.remove`
pra `cipa_election_candidates`). Frontend sem suíte automatizada
(estado real do projeto) — Playwright com sessão sintética + mock de
rota, contra a build de produção real.

## 7. Fora de escopo desta fase

- Mapeamento automático de qual treinamento cada cargo exige — escolha
  sempre manual da empresa.
- Notificação por e-mail/WhatsApp de vencimento de treinamento — só
  aparece na lista de pendências dentro do sistema.
- Certificado obrigatório — upload sempre opcional.
- Edição/correção de um registro de treinamento ou DDS já criado —
  só apagar e recriar.
- "Encerrar" uma edição de SIPAT — cada atividade tem seu próprio
  status, não existe trava de edição no nível da edição inteira.
- Reabrir/editar uma atividade de SIPAT de uma edição de ano anterior
  — tecnicamente possível (sem trava), mas não é um fluxo desenhado
  nesta fase, é só histórico.
- Lista nomeada de participantes do DDS — só contagem numérica.
- Card de Capacitação no dashboard principal da empresa — mesma
  decisão já registrada na Fase 12: integrar um resumo no dashboard
  principal é a última frente da lista, depois que os outros módulos
  também existirem.
