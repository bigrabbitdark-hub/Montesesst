---
name: perf-backend
description: Performance do backend NestJS/TypeScript do Montese SST. Use ao escrever endpoints, serviços, filas e integrações, ou ao investigar latência e consumo de CPU/memória da API.
---

# Performance do backend (NestJS)

## Princípio
O gargalo quase sempre está em I/O (banco, Redis, rede, IA), não na CPU do Node. Meça a latência por etapa antes de otimizar código.

## Método
1. Descubra **onde** o tempo vai: log de tempo por etapa (temporário e sem dados pessoais), `docker stats --no-stream montese_backend`, `docker logs --tail`.
2. Classifique: banco (use `perf-banco`), serviço externo (Mercado Pago, Google Calendar, R2, IA), CPU (PDF, parsing), memória (arquivos grandes em buffer).
3. Corrija o maior pedaço. Meça de novo.

## Regras práticas
- **Paralelize I/O independente** com `Promise.all`; não faça `await` em sequência quando as chamadas não dependem uma da outra. Mas dentro de **uma transação com contexto de tenant**, as queries seguem na mesma conexão (sequenciais).
- **Nada de trabalho lento dentro da transação** (HTTP, IA, geração de PDF). Faça antes ou depois.
- **N+1**: carregue em lote por IDs (veja `perf-banco`).
- **Paginação obrigatória** em listagens; limite máximo de `pageSize`. Nunca devolva tabela inteira.
- **Cache no Redis** só para dado caro e tolerante a defasagem (catálogos, agregações de dashboard). Chave **sempre com tenant** (`tenant:{id}:...`) para nunca vazar entre empresas. TTL e invalidação definidos. Nunca cachear resposta que dependa do papel do usuário sem incluir o papel na chave.
- **Trabalho pesado fora da requisição**: geração de relatório/PDF, sincronização (CAEPI), ingestão normativa, embeddings, e-mails. Use fila/job em vez de segurar a requisição.
- **Streams para arquivos**: upload/download de documentos com stream, sem carregar o arquivo inteiro na memória; limite de tamanho no upload.
- **Timeouts e retry com limite** em integrações externas; um serviço lento não pode travar a API inteira. Evite retry em operação não idempotente.
- **Respostas enxutas**: DTO de saída com só os campos necessários. Sem serialização de objetos grandes.
- **Logs**: nível adequado; sem log por item dentro de loop quente; nunca dados pessoais ou segredos.
- Não faça operação síncrona bloqueante (`fs.readFileSync`, `bcrypt` síncrono, regex catastrófica) em caminho de requisição.

## Não otimize à custa de
Autenticação, autorização, contexto de tenant, validação de entrada e auditoria.

## Saída esperada
Etapa lenta (com número), mudança, antes/depois (latência p50/p95 ou tempo da operação), risco, reversão.
