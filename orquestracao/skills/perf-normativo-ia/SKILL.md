---
name: perf-normativo-ia
description: Performance e custo da camada normativa/RAG/IA do Montese SST. Use ao mexer em ingestão de normas, embeddings, retrieval, prompts do copiloto e avaliação. Reduz latência e custo sem perder precisão normativa.
---

# Performance do RAG e da IA

## Princípio
Aqui, performance tem três eixos: **latência**, **custo (tokens/chamadas)** e **precisão normativa**. A precisão nunca é sacrificada: a IA não é a autoridade normativa e não pode inventar norma.

## Método
1. Linha de base com os evals existentes (`npm run eval:retrieval`, `eval:answer`, `eval:usage`) — mas eles chamam IA e têm custo: peça autorização antes. `eval:lint` e `eval:nr` são locais e baratos.
2. Decomponha a latência de uma resposta: recuperação (banco/vetor), montagem do contexto, chamada ao modelo, pós-processamento.
3. Mude uma coisa e compare métricas (recall/precisão do retrieval, qualidade da resposta, tokens, tempo).

## Regras práticas
- **Recuperação**: filtre por metadados (norma, vigência, fonte) **antes** da busca vetorial; limite `top_k` ao necessário; índice vetorial adequado; não varra a tabela inteira.
- **Contexto enxuto**: envie só os trechos relevantes (provisões), sem a norma inteira. Menos tokens = mais rápido e mais barato, e reduz alucinação.
- **Minimização de dados**: sem PII nem dados de saúde que a resposta não precise; isso também reduz tokens.
- **Cache** de resultados determinísticos (normas, provisões, embeddings já calculados) com chave por conteúdo/versão da norma. Invalide quando a versão vigente mudar. Nunca cache resposta que dependa de dados de uma empresa em escopo compartilhado.
- **Embeddings**: gere em lote, incremental (só o que mudou, por hash do conteúdo); reexecutar tudo só com autorização (custo).
- **Ingestão/monitor normativo**: processar fora da requisição (job), idempotente, com diff por parágrafos (já existente) para reprocessar só o que mudou; extração de PDF/HTML em stream e com limite de tamanho.
- **Chamada ao modelo**: `max_tokens` adequado, timeout e retry limitado, streaming para a UI quando fizer sentido. Não troque provider/modelo sem autorização.
- **Citações**: mantenha a fonte e a versão em toda resposta normativa; se o retrieval não achar fonte, a resposta correta é dizer que não há.
- **Prompts**: instruções curtas e estáveis (favorece cache de prefixo do provedor); sem repetir regras já no sistema.

## Saída esperada
Métricas antes/depois (latência, tokens por resposta, qualidade do eval), custo estimado, e confirmação de que nenhuma resposta normativa perdeu fonte.
