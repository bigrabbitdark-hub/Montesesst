# Fase 4 (sub-projeto B) — Score de SST + Pendências

> Segundo sub-projeto da Fase 4 (Dashboard Empresa: score de SST,
> pendências, documentos, agenda). Decisão confirmada em brainstorming de
> 2026-08-24: consome diretamente os dados que o sub-projeto A
> (Documentos) já criou — nenhuma infraestrutura nova de storage, nenhuma
> tabela nova. Agenda (a quarta peça da Fase 4) fica para um terceiro
> sub-projeto, spec própria.

## 1. Objetivo e escopo

Dar à empresa (e ao técnico responsável, que acompanha a conformidade de
fora) um indicador direto de "estamos em dia?" — um score em % e uma
lista do que está vencido ou perto de vencer — calculado em cima dos
documentos já cadastrados no sub-projeto A, sem nenhuma coleta de dado
nova.

**Não é objetivo desta sub-fase:**
- Modelar quais categorias de documento são "obrigatórias" por setor/
  risco da empresa — decisão confirmada: o score avalia só os
  documentos que já existem, não uma lista de exigências legais por
  tipo de empresa (isso exigiria capturar setor/CNAE com precisão, fora
  de escopo).
- Agenda — terceiro sub-projeto da Fase 4, spec própria.
- Qualquer notificação ativa (e-mail/push) quando algo vence ou está
  perto de vencer — esta fase só exibe a informação na tela, quando a
  pessoa entra no `/empresa/documentos` ou `/tecnico/empresas/[id]`.

## 2. Regra de cálculo

**Score:** só entram na conta documentos com `expires_at` preenchido —
um documento sem vencimento definido não tem como estar "em dia" ou
"vencido", então fica de fora do cálculo (mas continua listado
normalmente na seção de documentos, sem nenhuma mudança do
sub-projeto A).

```
score = (documentos com expires_at no futuro) / (total de documentos com expires_at preenchido) × 100
```

Arredondado pro inteiro mais próximo. **Se não existir nenhum documento
com `expires_at` preenchido, o score é `null`** (não `0%` nem `100%`) —
o frontend mostra "Sem dados ainda" nesse caso, decisão confirmada em
brainstorming: um número enganoso é pior que nenhum número.

**Pendência:** documento com `expires_at` no passado (já vencido).

**Aviso:** documento com `expires_at` nos próximos 30 dias (contando a
partir de hoje, inclusive) — ainda não é pendência, mas está perto de
virar uma. Documento com `expires_at` a mais de 30 dias no futuro não
aparece em nenhuma das duas listas (está "em dia", sem necessidade de
destaque).

## 3. Backend

### 3.1 `GET /documents/compliance` — endpoint novo

Mesmo módulo `documents` (não precisa de módulo novo). Mesma regra de
`tenant_id` já estabelecida em `GET /documents` (sub-projeto A): quando
quem chama é `tecnico`, exige `?tenant_id=` na query (400 se ausente);
quando é `empresa`, não precisa (RLS já restringe ao próprio tenant).
Sem `@Roles` (RLS decide o que a pessoa vê, mesmo padrão de `GET
/documents`).

**Resposta:**

```json
{
  "score": 75,
  "pendencias": [
    { "id": "...", "category": "pgr", "title": "PGR 2025", "expires_at": "2026-01-15", "dias_vencido": 220 }
  ],
  "avisos": [
    { "id": "...", "category": "ficha_epi", "title": "Ficha EPI João", "expires_at": "2026-09-10", "dias_restantes": 17 }
  ]
}
```

`score` é `number | null`. `pendencias`/`avisos` são sempre arrays
(vazios quando não há nada a mostrar), ordenados por `expires_at`
crescente (o mais urgente primeiro).

### 3.2 Cálculo

Uma query em `documents` filtrando `expires_at IS NOT NULL` (mais o
filtro de `tenant_id` explícito quando fornecido, mesmo padrão de
`findAll` no sub-projeto A — RLS já filtra por trás, o filtro explícito
é só pra UX do técnico escolher qual empresa). O resto (separar em
pendência/aviso/nem-um-nem-outro, calcular `dias_vencido`/
`dias_restantes`, calcular o score) é lógica em JS/TS no service, sem
precisar de SQL mais complexo — mesmo estilo já usado no resto do
projeto (cálculo de negócio em TypeScript, não em stored procedures).

## 4. Frontend

O bloco de score/pendências entra dentro do **próprio `DocumentsPanel.tsx`**
(componente já compartilhado entre `/empresa/documentos` e
`/tecnico/empresas/[tenantId]`, sub-projeto A) — no topo, antes do
formulário de upload. Como o componente já é reaproveitado nos dois
lugares, isso aparece automaticamente nas duas telas sem nenhuma mudança
adicional nas páginas que o usam.

- Score: número grande em %, ou "Sem dados ainda" quando `null`.
- Pendências (se houver): lista destacada (cor de alerta), cada item
  mostrando categoria + título + há quantos dias venceu.
- Avisos (se houver): lista mais discreta (cor neutra/amarela), cada
  item mostrando categoria + título + em quantos dias vence.
- Se não houver pendência nem aviso (e o score não for `null`): mensagem
  simples de "tudo em dia".

## 5. Testes

Mesmo padrão do projeto: e2e reais contra Postgres real, sem mock.
Casos obrigatórios:
- Empresa com documentos vencidos, perto de vencer, e em dia (misturados)
  — confirma que `GET /documents/compliance` classifica cada um
  corretamente e calcula o score certo.
- Empresa sem nenhum documento com `expires_at` — confirma `score: null`.
- Documento sem `expires_at` não entra na conta do score nem aparece em
  pendências/avisos.
- Técnico sem `?tenant_id=` na query recebe 400 (mesma regra de `GET
  /documents`).
- RLS: empresa não vê pendência/aviso de outro tenant (reaproveita a
  mesma garantia já provada pra `GET /documents` no sub-projeto A — não
  precisa reprovar RLS do zero, só confirmar que o endpoint novo herda
  o mesmo comportamento).

## 6. Decisões confirmadas (brainstorming de 2026-08-24)

| Decisão | Escolha |
|---|---|
| Categorias obrigatórias | Nenhuma — score avalia só o que já foi enviado |
| Score sem nenhum documento com vencimento | `null` / "Sem dados ainda", não 0% nem 100% |
| Quando alertar | Vencido = pendência real; até 30 dias antes = aviso |
| Onde aparece | Dentro da página/componente de documentos já existente, não uma página nova |
| Técnico vê o score da empresa vinculada | Sim |

## 7. Pendências

- [ ] **Agenda** — terceiro sub-projeto da Fase 4, spec própria.
- [ ] **Notificação ativa de vencimento** (e-mail/push) — fora de
      escopo, a pessoa só vê a informação quando entra na tela.
