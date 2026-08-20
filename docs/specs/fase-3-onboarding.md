# Fase 3 — Onboarding (dados da empresa, filiais, funcionários)

> Primeira fase do roadmap original das 8 fases a ser retomada depois da
> iniciativa de pagamento (cadastro técnico + Planos/Assinaturas via
> Mercado Pago, sub-projetos A e B, concluídos). Decisões confirmadas em
> brainstorming de 2026-08-20.

## 1. Objetivo e escopo

Depois do primeiro login, hoje a empresa não tem pra onde ir — o
Dashboard Empresa (Fase 4) ainda não existe. Esta fase dá à empresa um
jeito de completar os dados que faltam desde o cadastro (que hoje só
pede nome + CNPJ): setor de atividade, contato responsável, unidades/
filiais com endereço, e a lista de funcionários — dados que a Fase 4 vai
precisar pra existir de verdade.

**Não é objetivo desta fase** construir nenhuma versão, nem que seja
mínima, do Dashboard Empresa — ao terminar (ou pular) o onboarding, a
empresa cai numa tela simples de "cadastro em dia, Dashboard em
construção", sem fingir uma funcionalidade que ainda não existe.

**Decisão confirmada:** o onboarding é **totalmente opcional** — a
empresa pode pular tudo, preencher só uma parte, ou voltar quantas vezes
quiser, em qualquer ordem. Por isso ele não é um "wizard" com passos
travados (Passo 1 de 3): é uma página única com três blocos
independentes, cada um funcionando como CRUD normal. O "progresso" nunca
é armazenado à parte — é sempre derivado on-the-fly dos dados reais
(setor preenchido? existe ao menos uma filial? existe ao menos um
funcionário?), evitando um estado duplicado que poderia dessincronizar
do dado real.

## 2. Modelo de dados

### 2.1 `tenants` — 3 colunas novas

```sql
ALTER TABLE tenants ADD COLUMN sector TEXT;
ALTER TABLE tenants ADD COLUMN contact_name TEXT;
ALTER TABLE tenants ADD COLUMN contact_phone TEXT;
```

Todas nullable — uma empresa cadastrada antes desta fase existir
continua válida sem preencher nada.

### 2.2 `company_units` (filiais) — tabela nova

```sql
CREATE TABLE company_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_number TEXT,
  address_city TEXT NOT NULL,
  address_state VARCHAR(2) NOT NULL,
  address_zip VARCHAR(8) NOT NULL,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_company_units_updated_at BEFORE UPDATE ON company_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE company_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_units FORCE ROW LEVEL SECURITY;
CREATE POLICY company_units_isolation ON company_units USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
);
```

Mesmo padrão de RLS já usado em `employees`/`subscriptions` — `admin` vê
tudo, senão só o próprio tenant. `name` é livre (ex: "Sede", "Filial São
Paulo") — não há um conceito de "matriz obrigatória", qualquer filial
cadastrada primeiro funciona como a principal na prática.

### 2.3 `employees` — 1 coluna nova

```sql
ALTER TABLE employees ADD COLUMN company_unit_id UUID
  REFERENCES company_units(id) ON DELETE SET NULL;
```

Nullable de propósito — funcionários cadastrados antes desta fase
continuam válidos sem filial atribuída (não é migração retroativa de
dado, só passa a ser preenchido daqui pra frente). Formulário de
cadastro de funcionário (manual ou CSV) exige escolher uma filial já
existente; se a empresa ainda não cadastrou nenhuma, mostra "cadastre
uma filial primeiro" com atalho pro bloco de Filiais.

Deletar uma filial com funcionários vinculados não bloqueia
(`ON DELETE SET NULL`) — os funcionários ficam sem filial atribuída, sem
perder o cadastro.

## 3. Backend — módulos e endpoints

### 3.1 `tenants` (módulo novo — hoje não existe nenhum jeito da própria
empresa ver/editar seus dados)

- `GET /tenants/me` — retorna o tenant do usuário autenticado
  (`@Roles('empresa')`, lê `req.user.tenantId`).
- `PATCH /tenants/me` — atualiza `sector`, `contact_name`,
  `contact_phone` (allowlist via `buildSafeSetClause`, mesmo utilitário
  já usado em `employees`/`technicians`/`partners` desde o fix de
  segurança do sub-projeto A — nunca montar `UPDATE ... SET` livre a
  partir do corpo da requisição).

### 3.2 `company-units` (módulo novo)

CRUD completo, mesmo formato de `employees.controller.ts`:
- `POST /company-units` — cria filial pro tenant do usuário autenticado.
- `GET /company-units` — lista as filiais do próprio tenant.
- `GET /company-units/:id` — busca uma (RLS garante que só vê a própria).
- `PATCH /company-units/:id` — atualiza (allowlist: `name`,
  `address_street`, `address_number`, `address_city`, `address_state`,
  `address_zip`, `status`).
- `DELETE /company-units/:id`.

### 3.3 `employees` (módulo existente — 2 mudanças)

- `CreateEmployeeDto`/`UpdateEmployeeDto` ganham `company_unit_id?: string`
  (adicionado à allowlist de `buildSafeSetClause` em
  `employees.service.ts`).
- **Novo endpoint:** `POST /employees/import` (`@Roles('empresa', 'admin')`,
  `multipart/form-data`, campo `file`) — importação em lote via CSV.

**Formato do CSV** (cabeçalho obrigatório, nesta ordem):
```
nome,cpf,cargo,filial
João da Silva,12345678900,Operador,Sede
Maria Souza,98765432100,Técnica de Segurança,Filial São Paulo
```
`filial` casa pelo **nome** da `company_unit` já cadastrada pro tenant
(não pelo UUID — quem preenche a planilha não sabe IDs). Nome de filial
que não bate com nenhuma cadastrada é erro daquela linha, não do arquivo
inteiro.

**Processamento linha a linha, sem tudo-ou-nada:** cada linha é validada
e inserida independentemente; uma linha com problema não derruba as
demais. Resposta:

```json
{
  "importados": 8,
  "erros": [
    { "linha": 3, "motivo": "CPF inválido (precisa ter 11 dígitos)" },
    { "linha": 5, "motivo": "Filial \"Filial RJ\" não encontrada" },
    { "linha": 7, "motivo": "CPF já cadastrado nesta empresa" }
  ]
}
```

Validação de CPF nesta fase é só **formato** (11 dígitos numéricos) —
mesmo nível de rigor já aplicado no cadastro manual de funcionário hoje
(não existe validação de dígito verificador de CPF em nenhum lugar do
sistema atual, não é este o momento de introduzir isso). Duplicidade
(CPF já existe pro mesmo tenant) é pega pela constraint
`UNIQUE (tenant_id, cpf)` já existente, traduzida em mensagem de erro
amigável do mesmo jeito que `mapPgError` já faz em outros services
(`subscriptions.service.ts`, por exemplo) — não uma verificação
duplicada em código.

**Limite:** arquivo com mais de 2000 linhas é rejeitado de cara (400,
antes de processar qualquer linha), evitando prender a requisição/o
pool de conexões processando um arquivo gigante.

**Encoding:** CSV lido como UTF-8; acentos em nome/cargo/filial tratados
normalmente (diferente do caso de e-mail da Fase de pagamento, aqui não
há necessidade de remover acentos — são só texto livre, não um valor que
uma API externa valida).

## 4. Frontend

**Contexto novo, não percebido antes de checar o código:** hoje não
existe nenhuma área autenticada no frontend — `/login` é uma rota solta
(não dentro de um route group) e, ao logar, sempre redireciona pra `/`
(a home pública), independente do papel do usuário. Esta fase introduz a
primeira página autenticada de verdade do frontend.

Página nova: `frontend/src/app/empresa/onboarding/page.tsx` (rota solta,
mesmo padrão de `/login` — sem criar um route group `(app)` agora só pra
uma página só; isso fica pra quando a Fase 4/5 justificar a
organização).

**Mudança no login:** `router.push('/')` (`frontend/src/app/login/page.tsx`)
passa a checar o `role` retornado no login — `empresa` vai pra
`/empresa/onboarding`, qualquer outro papel (`tecnico`, `parceiro`,
`admin`) continua indo pra `/` como hoje (não há destino melhor definido
pra eles ainda, fora de escopo desta fase).

Três blocos independentes, sem ordem obrigatória:

1. **Dados da empresa** — formulário (setor, nome do contato, telefone).
   `PATCH /tenants/me` ao enviar.
2. **Filiais** — lista das já cadastradas + formulário "adicionar
   filial". CRUD contra `company-units`.
3. **Funcionários** — duas entradas lado a lado:
   - Manual: formulário (nome, CPF, cargo, dropdown de filial já
     cadastrada), botão "adicionar outro" repete o formulário limpo.
   - CSV: upload de arquivo, mostra o resumo de importados/erros depois
     de processar.

Um link **"Completar cadastro da empresa"** aparece depois do login
enquanto houver algo faltando (calculado no frontend a partir da
resposta de `GET /tenants/me` + `GET /company-units` — sem estado de
progresso guardado à parte). Some sozinho quando setor + ao menos uma
filial + ao menos um funcionário existirem.

Ao "terminar" (ou a qualquer momento em que o usuário decida sair),
volta pra uma tela simples: **"Cadastro em dia — o Dashboard está sendo
construído"**.

## 5. Testes

Mesmo padrão do projeto inteiro — e2e reais contra o Postgres real
(Docker), sem mock de banco:

- RLS de `company_units` confirmada (uma empresa não vê filial de
  outra) — mesmo formato de teste já usado pra `subscriptions`
  (`backend/test/subscriptions-rls.e2e-spec.ts`).
- `PATCH /tenants/me` só atualiza os 3 campos permitidos, nunca aceita
  `id`/`cnpj`/`plan` vindos do corpo (allowlist).
- `POST /employees/import`: teste com um CSV real contendo linhas
  válidas e linhas propositalmente inválidas (CPF malformado, filial
  inexistente, CPF duplicado) — confirma que as válidas são importadas
  e que o relatório de erro aponta a linha certa com o motivo certo.
- `DELETE /company-units/:id` com funcionário vinculado — confirma que o
  funcionário continua existindo, só com `company_unit_id = NULL`.

## 6. Decisões confirmadas (brainstorming de 2026-08-20)

| Decisão | Escolha |
|---|---|
| Escopo | Coletar dados cadastrais completos + cadastrar funcionários (não inclui vínculo com técnico responsável nesta fase) |
| Obrigatoriedade | Totalmente opcional — pode pular tudo e voltar quando quiser |
| Formato da experiência | Checklist/painel com 3 blocos independentes, sem ordem obrigatória (não wizard linear) |
| Depois de completar/sair | Tela simples "cadastro em dia, Dashboard em construção" — não antecipa nada da Fase 4 |
| Filiais | Modeladas agora (não adiadas) — cada filial tem endereço próprio e funcionários vinculados a ela |
| Cadastro de funcionários | Os dois: manual (formulário repetido) e importação em massa via CSV |
| Progresso do onboarding | Sempre derivado dos dados reais, nunca armazenado como estado à parte |

## 7. Pendências

- [ ] **Vínculo com técnico responsável** — fora de escopo nesta fase
      (não existe hoje nenhum fluxo de solicitar/aceitar entre empresa e
      técnico); revisitar quando a Fase 4/5 (Dashboards) existirem.
- [ ] **Validação de dígito verificador de CPF** — nem o cadastro manual
      nem o CSV validam isso hoje; é uma lacuna pré-existente do
      projeto, não introduzida por esta fase, mas fica registrada como
      possível hardening futuro.
