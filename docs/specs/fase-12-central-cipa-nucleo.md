# Fase 12 — Central da CIPA (núcleo)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-01,
> a partir de um documento de expansão ("Expansão Completa do Dashboard
> Montesse SST") trazido pelo fundador. Esse documento descreve uma
> expansão bem maior que uma spec só comporta — decomposta em
> sub-projetos independentes (ver `docs/roadmap.md`); esta é a
> **primeira** frente: o núcleo da Central da CIPA, sem IA/áudio e sem
> eleição digital, que ficam para frentes seguintes.

## 1. Objetivo e escopo

O fundador quer a CIPA (Comissão Interna de Prevenção de Acidentes)
como uma das ferramentas centrais do Montese SST — não um item de menu
a mais, mas um fluxo completo de gestão: calendário de reuniões,
membros, atas com aprovação humana, e pendências. Esta fase entrega o
núcleo operacional desse fluxo — calendário guiado, reuniões
(ordinárias e extraordinárias) com ata estruturada digitada à mão,
membros, pendências e documentos — sem a parte de IA/transcrição de
áudio (frente própria seguinte) e sem eleição/votação digital (frente
própria mais adiante).

**Decisões fechadas em brainstorming, não reabrir sem motivo novo:**

- **Sem sub-papéis nesta fase.** Gestão da CIPA (criar reunião, editar
  membro, aprovar ata) roda com o papel `empresa` já existente — não
  há distinção RH/Gestor/Membro da CIPA no controle de acesso. Se
  isso virar necessidade real, é uma frente própria futura.
- **Sem login de colaborador.** Tudo que envolveria colaborador
  logando (votação própria, reconhecimento individual autoatendido)
  fica fora — nesta fase e nas seguintes de CIPA, quem opera é sempre
  um usuário `empresa` (ou leitura por `tecnico`/`parceiro`).
- **CIPA é por estabelecimento (`company_unit`), não por empresa
  inteira.** Bate com a exigência legal real (cada estabelecimento
  acima de certo porte pode precisar da própria CIPA). Empresa com um
  só estabelecimento não percebe diferença.
- **"Plano de Ação" (por reunião) e "Pendências da CIPA" são a mesma
  entidade**, não duas tabelas — uma pendência pode nascer de uma
  reunião (`meeting_id` preenchido) ou ser registrada solta
  (`meeting_id` nulo).
- **"Documentos da CIPA" reaproveita a tabela `documents` já
  existente** (upload/download/RLS/`company_unit_id` já prontos) —
  não é um módulo de biblioteca novo, só categorias novas no `CHECK`
  existente.
- **Ata sem IA nesta fase**: os mesmos campos estruturados que a IA
  vai preencher automaticamente na próxima frente são digitados à mão
  por um usuário `empresa` nesta. Mesmo fluxo rascunho → aprovação.
  Isso garante que a próxima frente (IA) não precise redesenhar
  schema nenhum — só passa a preencher os campos que já existem.

**Fora de escopo desta fase** (frentes futuras, na ordem acordada):

- Upload de áudio/arquivo → transcrição → IA gerando rascunho de ata.
- Eleição/votação digital da CIPA.
- Treinamentos, DDS (módulo completo), SIPAT.
- Reconhecimento/gamificação (Troféu Montese, Empresa Destaque).
- Consulta de CA, Documentos Técnicos (LTCAT/LIP).
- Card da CIPA dentro do **dashboard principal** da empresa — esta
  fase entrega o dashboard **da própria Central da CIPA**; integrar
  um resumo no dashboard principal é a última frente da lista
  (redesenho do dashboard principal), depois que os outros módulos
  também existirem.

## 2. Reaproveitamento e fundação de navegação

Duas peças pequenas, mas reais e hoje ausentes, entram nesta fase
porque são pré-requisito direto pra CIPA aparecer na interface:

- **Sidebar unificada com grupos/submenus.** Hoje existem duas
  sidebars quase idênticas (`EmpresaSidebar.tsx`, `AdminSidebar.tsx`),
  ambas listas planas sem agrupamento, e **o técnico não tem sidebar
  nenhuma** (navegação por link solto dentro de cada página). Esta
  fase reorganiza as duas existentes em grupos com submenu (Visão
  Geral, Segurança, CIPA, Conta) e cria a primeira sidebar do técnico.
  Sem biblioteca de ícones no projeto hoje — usar emoji/glyphs
  simples nos grupos, consistente com o tom já usado no restante da
  interface (ex.: `⚠️ Sua atenção hoje` no dashboard atual), não
  introduzir uma dependência nova só por isso.
- **Logout de verdade.** Não existe hoje — nenhuma página remove o
  token do `localStorage`. Adicionar um botão que limpa
  `montese_token`/`montese_user` e redireciona pra `/login`.

Reaproveitado sem nenhuma mudança: `documents`/`r2.service.ts`
(upload/download), `company_units` (já existe desde a Fase 4B/Fase 7),
padrão de RLS com branch admin/empresa/técnico/parceiro já usado em
`0011_partner_access.sql`.

## 3. Modelo de dados

Migration nova: `backend/db/migrations/0023_cipa_nucleo.sql`. Todas as
tabelas guardam `tenant_id` **e** `company_unit_id` — `tenant_id`
porque é o padrão de RLS já usado em toda tabela do projeto (mesmo
mecanismo, sem inventar um novo baseado em join contra
`company_units`), `company_unit_id` porque é o filtro real que a
funcionalidade precisa (uma CIPA por estabelecimento).

```sql
CREATE TABLE cipa_committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  data_inicio DATE NOT NULL,
  data_termino DATE NOT NULL,
  responsavel_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cipa_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES cipa_committees(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ordinaria', 'extraordinaria')),
  numero INTEGER, -- só ordinária, 1-12
  titulo TEXT, -- só extraordinária
  data DATE,
  hora TIME,
  local TEXT,
  modalidade TEXT CHECK (modalidade IN ('presencial', 'online', 'hibrida')),
  motivo TEXT, -- só extraordinária
  responsavel_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'agendada', 'realizada', 'cancelada', 'reagendada')),
  -- checklist antes/durante/depois — 9 itens fixos do PDF, sem tabela filha
  chk_pauta_definida BOOLEAN NOT NULL DEFAULT false,
  chk_participantes_convocados BOOLEAN NOT NULL DEFAULT false,
  chk_local_confirmado BOOLEAN NOT NULL DEFAULT false,
  chk_presenca_registrada BOOLEAN NOT NULL DEFAULT false,
  chk_assuntos_discutidos BOOLEAN NOT NULL DEFAULT false,
  chk_decisoes_registradas BOOLEAN NOT NULL DEFAULT false,
  chk_ata_criada BOOLEAN NOT NULL DEFAULT false,
  chk_acoes_distribuidas BOOLEAN NOT NULL DEFAULT false,
  chk_pendencias_registradas BOOLEAN NOT NULL DEFAULT false,
  -- conteúdo da ata (estruturado, digitado à mão nesta fase)
  pauta TEXT,
  discussoes TEXT,
  deliberacoes TEXT,
  proxima_reuniao_data DATE,
  status_ata TEXT NOT NULL DEFAULT 'rascunho' CHECK (status_ata IN ('rascunho', 'aprovada')),
  aprovado_por_user_id UUID REFERENCES users(id),
  aprovado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ordinaria_numero CHECK (
    (tipo = 'ordinaria' AND numero IS NOT NULL AND titulo IS NULL AND motivo IS NULL)
    OR (tipo = 'extraordinaria' AND numero IS NULL AND titulo IS NOT NULL)
  )
);

CREATE TABLE cipa_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  funcao_empresa TEXT,
  setor TEXT,
  funcao_cipa TEXT NOT NULL CHECK (funcao_cipa IN ('presidente', 'vice_presidente', 'secretario', 'membro')),
  titular_suplente TEXT NOT NULL CHECK (titular_suplente IN ('titular', 'suplente')),
  representacao TEXT NOT NULL CHECK (representacao IN ('empregador', 'empregados')),
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Depende de cipa_members — precisa vir depois dela nesta migration.
CREATE TABLE cipa_meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  cipa_member_id UUID REFERENCES cipa_members(id) ON DELETE SET NULL,
  nome_livre TEXT, -- pra participante que não é membro (ex.: técnico convidado)
  presente BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_participant_source CHECK (
    (cipa_member_id IS NOT NULL AND nome_livre IS NULL)
    OR (cipa_member_id IS NULL AND nome_livre IS NOT NULL)
  )
);

CREATE TABLE cipa_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  meeting_id UUID REFERENCES cipa_meetings(id) ON DELETE SET NULL, -- nulo = registrada solta
  descricao TEXT NOT NULL,
  responsavel_user_id UUID REFERENCES users(id),
  prazo DATE,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'andamento', 'concluida', 'atrasada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Todas com `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` e
uma policy por tabela, **copiando exatamente** o padrão de
`0011_partner_access.sql` (branch admin, branch empresa via
`tenant_id`, branch técnico via `tenant_technicians`, branch parceiro
via `tenant_partners`) — mesma estrutura já usada em toda tabela do
projeto, só que aqui técnico/parceiro têm **só leitura** (a policy
`USING` não muda por operação; a restrição de escrita pro papel
técnico/parceiro acontece no `@Roles(...)` dos endpoints de mutação,
não na RLS — mesma divisão de responsabilidade já usada em
`inspections`/`documents`). `cipa_meeting_participants` não tem
`tenant_id` própria — igual `inspection_checklist_items`, delega via
`EXISTS (SELECT 1 FROM cipa_meetings m WHERE m.id = cipa_meeting_participants.meeting_id)`.

Extensão da tabela `documents` já existente — migration adiciona
categorias novas ao `CHECK` de `category`:

```sql
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (
  category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
               'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo')
);
```

## 4. Fluxo do gerador de calendário

Wizard de 2 passos, endpoint dedicado (não é um CRUD genérico de
`cipa_committees`):

1. **Dados da gestão**: ano, data de início/término, estabelecimento
   (`company_unit_id`), responsável. Cria a `cipa_committees`.
2. **Geração das 12 reuniões ordinárias**: usuário informa dia da
   semana preferido + horário + local (opcional — pode pular e
   preencher depois); o sistema insere as 12 linhas de
   `cipa_meetings` (`tipo='ordinaria'`, `numero` 1 a 12, `status`
   `'planejada'`) já com datas sugeridas (mesma regra de todo mês,
   ajustada pro dia da semana escolhido) se informado, ou `data NULL`
   se não. **Nada fica definitivo** — toda reunião gerada continua
   100% editável depois, igual qualquer outra.

Reunião extraordinária é um endpoint separado, sem depender do
gerador — cria uma linha avulsa em `cipa_meetings`
(`tipo='extraordinaria'`) a qualquer momento.

## 5. Página da reunião (ata estruturada)

Cada reunião tem sua própria página. Edição dos campos de ata
(pauta/discussões/deliberações/participantes/pendências) só é
permitida enquanto `status_ata = 'rascunho'`. Ação **"Aprovar ata"**
(qualquer usuário `empresa` do tenant) muda `status_ata` pra
`'aprovada'`, grava `aprovado_por_user_id`/`aprovado_em`, e trava
edição — reabrir exige uma ação explícita de "reverter pra rascunho"
(mesmo usuário/papel, sem aprovação dupla nesta fase, já que não há
distinção de papel pra exigir isso). Ao aprovar, o sistema monta um
PDF simples (dados da reunião + campos preenchidos) e grava como um
`documents` novo (`category='cipa_ata'`, `company_unit_id` da
reunião) — reaproveitando `r2.service.ts` sem mudança.

## 6. API (resumo — detalhamento fica pro plano)

Módulo novo `backend/src/cipa/`, seguindo o padrão de
`req.withTenantContext(...)`/`@Roles(...)`/`ValidationPipe` já
estabelecido:

- `POST /cipa/committees` (gerador, passo 1) — `@Roles('empresa')`.
- `POST /cipa/committees/:id/generate-meetings` (gerador, passo 2) —
  `@Roles('empresa')`.
- `POST /cipa/meetings` (extraordinária avulsa) — `@Roles('empresa')`.
- `GET /cipa/meetings` (lista/calendário/anual — mesmo endpoint,
  visualização é responsabilidade do frontend sobre os mesmos dados).
- `GET /cipa/meetings/:id`, `PATCH /cipa/meetings/:id` (edição de
  campos, incluindo ata e checklist) — `@Roles('empresa')` pra
  `PATCH`, leitura aberta a técnico/parceiro vinculados.
- `POST /cipa/meetings/:id/aprovar-ata`, `POST /cipa/meetings/:id/reabrir-ata`
  — `@Roles('empresa')`.
- `GET/POST/PATCH /cipa/members` — `@Roles('empresa')` pra mutação.
- `GET/POST/PATCH /cipa/pendencias` — `@Roles('empresa')` pra mutação.

## 7. Dashboard da Central da CIPA

Página própria (não o dashboard principal — ver seção 1), cards:
próxima reunião, reuniões realizadas, reuniões pendentes, membros
ativos, pendências abertas, última ata, próximo evento, status do
calendário anual (quantas das 12 já têm data confirmada).

## 8. Testes

Mesma disciplina do projeto inteiro — Postgres real, sem mock:

- Gerador de calendário cria exatamente 12 reuniões ordinárias com
  `numero` 1-12.
- RLS: empresa não vê CIPA de outro tenant; técnico vinculado vê mas
  não edita (403 em `PATCH`); técnico não vinculado não vê (404).
- Isolamento entre `company_unit`: duas unidades da mesma empresa têm
  CIPAs completamente separadas (reuniões, membros, pendências).
- Ata: editar depois de aprovada é rejeitado; aprovar grava
  `aprovado_por_user_id`/`aprovado_em` e gera o `documents`
  (`category='cipa_ata'`); reabrir volta pra rascunho e permite editar
  de novo.
- Pendência com `meeting_id` nulo (registrada solta) e com
  `meeting_id` preenchido (nascida de reunião) — os dois casos
  funcionam na mesma tabela/endpoint.
- Logout: token realmente some do `localStorage`, rota protegida
  redireciona pra `/login` depois.

## 9. Pendências

- [ ] Sub-papéis dentro de `empresa` (RH/Gestor/Membro CIPA) —
  deliberadamente fora de escopo (seção 1); entra como frente própria
  se a demanda confirmar necessidade.
- [ ] Exportação da ata em formato editável (Word) — só PDF nesta
  fase (seção 5); "documento editável"/"versão para impressão" do PDF
  original ficam pra quando o Assistente de Ata (IA) chegar.
- [ ] Fim de gestão (`cipa_committees.status = 'encerrada'`) não tem
  fluxo de transição automática nesta fase — fica manual.
