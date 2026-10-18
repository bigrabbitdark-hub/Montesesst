---
name: perf-qa
description: Performance e eficiência dos testes do Montese SST. Use para deixar a suíte rápida e confiável, escolher o que rodar por tipo de mudança e detectar regressão de desempenho. Nunca à custa de cobertura de isolamento de tenant.
---

# Performance da qualidade (testes rápidos e confiáveis)

## Princípio
Teste lento não é rodado; teste instável não é confiável. Rode o **menor conjunto que dá confiança**, e o conjunto completo antes de encerrar.

## O que rodar por tipo de mudança
| Mudança | Rodar primeiro | Antes de encerrar |
|---|---|---|
| Frontend (componente/tela) | `npm test -- <arquivo>`, `typecheck` | `lint`, `test`, `build` |
| Backend (serviço/regra) | `test:unit` focado no módulo | `test:unit` completo + `build` |
| Rota, guard, RLS, tenant | `test:isolation` | `test:e2e` do módulo |
| Migration | revisão + teste de isolamento | e2e dos módulos afetados |
| Normativo/IA | `eval:lint`, `eval:nr` (locais) | evals com IA só com autorização |

## Regras
- **Segurança do ambiente**: `test:e2e` e `test:isolation` usam banco real via `run-backend-tests.sh`. Descubra qual banco antes e **não rode contra produção**. Peça um banco de teste.
- Execução focada: Jest `-t "nome"` ou caminho do arquivo; Vitest `-t`/arquivo; Playwright por arquivo/tag. Evite rodar e2e inteiro para cada ajuste.
- **e2e do backend roda em série** (`--runInBand`) por compartilharem banco: paralelizar sem isolar dados causa falha intermitente. Para ganhar velocidade, isole dados por teste (tenant próprio criado no teste) em vez de ligar paralelismo cego.
- Mocke serviços externos (Mercado Pago, Google, R2, IA) em unit tests; nunca chame serviço pago em teste automático.
- **Flaky**: ao ver falha intermitente, ache a causa (ordem, tempo, dado compartilhado). Não use retry/sleep fixo para esconder.
- Testes novos de dado de tenant sempre incluem o **acesso cruzado** (A não vê B).
- Medir: tempo por suíte (`--verbose`/`--durations`); liste os testes mais lentos e ataque os 3 piores antes de mexer em configuração.
- Regressão de performance: para caminhos críticos, um teste/medição com limite generoso (ex.: contagem de queries por requisição) evita o N+1 voltar.

## Saída esperada
Lista do que foi rodado com resultado, tempo, o que não foi rodado e por quê, veredito.
