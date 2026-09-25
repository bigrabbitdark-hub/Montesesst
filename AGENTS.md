# AGENTS.md — MONTESE SST

## Projeto

Montese SST é um SaaS multi-tenant para gestão operacional de Segurança e Saúde do Trabalho.

## Regra principal

Antes de modificar código:

1. entender a tarefa;
2. localizar o código existente;
3. verificar arquitetura;
4. verificar testes;
5. verificar segurança;
6. verificar multi-tenancy;
7. propor plano quando a tarefa for complexa.

Não inventar arquitetura.

Não duplicar funcionalidades existentes.

## Stack

Backend:

* NestJS
* TypeScript
* PostgreSQL
* pg
* Redis
* JWT
* Passport
* bcrypt

Frontend:

* Next.js
* React
* TypeScript
* Tailwind

Infraestrutura:

* Docker
* Nginx
* PostgreSQL
* Redis
* R2/S3-compatible storage

IA:

* MiniMax como modelo principal conforme arquitetura atual.
* Não alterar provider/modelo sem autorização.

## Multi-tenancy

O isolamento entre tenants é crítico.

Sempre respeitar:

* tenant context;
* RLS;
* FORCE RLS;
* autenticação;
* autorização;
* roles.

Nunca confiar apenas em IDs enviados pelo frontend.

Nunca acessar dados de outro tenant.

## Banco

Alterações de schema devem utilizar migrations.

Nunca executar alteração destrutiva sem autorização explícita.

Nunca utilizar:

```bash
docker compose down -v
```

em ambiente que possa conter dados reais.

## Segurança

Nunca expor:

* API keys;
* JWT secrets;
* passwords;
* tokens;
* credenciais;
* private keys.

Não colocar secrets em código ou logs.

## SST

Informações normativas devem utilizar fontes oficiais e a infraestrutura de RAG existente.

Nunca inventar:

* normas;
* artigos;
* prazos;
* obrigações;
* penalidades;
* requisitos legais.

A IA não é a autoridade normativa.

## IA

Antes de enviar informações ao modelo, considerar minimização de dados e PII.

Não enviar dados pessoais ou de saúde desnecessários.

Não alterar provider/modelo sem autorização.

## Frontend

Priorizar:

* clareza;
* simplicidade;
* acessibilidade;
* responsividade;
* consistência;
* feedback ao usuário.

Não criar elementos visuais sem função.

## Testes

Toda alteração relevante deve ser validada.

Quando aplicável:

* unit tests;
* integration tests;
* e2e;
* tenant isolation;
* build;
* typecheck.

## Git

Não executar automaticamente:

* commit;
* push;
* reset;
* revert;
* force push;
* alteração de histórico.

O proprietário decide quando fazer commit/push.

## Infraestrutura

Não alterar automaticamente:

* Docker;
* Nginx;
* PostgreSQL;
* Redis;
* TLS;
* DNS;
* backups;
* secrets;
* produção.

Primeiro analisar e pedir autorização.

## Comunicação

Nunca afirmar que algo funciona sem verificar.

Use:

* VERIFICADO
* NÃO VERIFICADO
* INFERIDO
* RECOMENDADO

Quando houver incerteza, declare-a.

## Princípio

```text
SEGURANÇA
→ CORREÇÃO
→ ISOLAMENTO
→ RASTREABILIDADE
→ MANUTENÇÃO
→ SIMPLIFICIDADE
→ UX
→ PERFORMANCE
→ ESTÉTICA
```

O objetivo é evoluir o Montese sem destruir o que já funciona.
