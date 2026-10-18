---
name: perf-frontend
description: Performance do frontend Next.js/React do Montese SST. Use ao criar telas e componentes ou ao investigar carregamento lento, bundle grande e re-render excessivo.
---

# Performance do frontend (Next.js + React)

## Princípio
Performance percebida pelo usuário: carregar rápido, responder ao clique, não "pular" a tela. Meça antes de otimizar.

## Método
1. Medir: `npm run build` mostra o tamanho por rota; Lighthouse/Web Vitals (LCP, INP, CLS) na página afetada; React Profiler para re-render.
2. Achar o maior custo: JS enviado, imagem, requisição em cascata, re-render.
3. Corrigir um item, medir de novo.

## Regras práticas
- **Server Components por padrão**; `"use client"` só no menor componente que precisa de estado/evento. Isso reduz JS enviado.
- **Busca de dados em paralelo**, nunca em cascata (evite um `await` depois do outro quando independentes). Carregue no servidor quando possível e use `Suspense` para streaming de partes lentas.
- **Bundle**: `next/dynamic` para componente pesado e raro (editores, gráficos, PDF viewer, calendário). Importe só o que usa de uma lib (nada de `import *`). Verifique antes de adicionar dependência: o custo em KB conta.
- **Imagens**: `next/image` com `width/height` (evita CLS), formatos modernos, `priority` só na imagem acima da dobra. Os cards de notícia e logos são candidatos.
- **Fontes**: `next/font`, sem bloquear renderização.
- **Listas grandes** (funcionários, documentos, EPIs, auditoria): paginação ou virtualização; nunca renderizar milhares de linhas.
- **Re-render**: estado no menor escopo; `useMemo`/`useCallback`/`memo` só onde o Profiler mostrar custo real; chaves estáveis em listas; não criar objetos/funções novos em props de componentes pesados sem necessidade.
- **Formulários e busca**: `debounce` em busca/autocomplete; evitar validação pesada a cada tecla.
- **Cache e revalidação** do Next conscientes: dados por empresa/usuário **nunca** em cache compartilhado entre tenants. Em caso de dúvida, não cachear dado autenticado.
- **Feedback imediato**: estados de loading/skeleton e atualização otimista só onde o erro é recuperável. É requisito de UX do projeto.
- **Acessibilidade e performance juntas**: elementos nativos (`button`, `a`) em vez de `div` clicável custam menos e funcionam melhor.

## Validação
`npm run typecheck`, `npm run lint` (zero warnings), `npm test`; e a medição de antes/depois.

## Saída esperada
Métrica antes/depois (tamanho da rota, LCP/INP, tempo do Profiler), arquivos alterados e riscos.
