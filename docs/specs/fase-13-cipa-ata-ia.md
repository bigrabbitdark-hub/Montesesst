# Fase 13 — Central da CIPA: ata por IA (upload de áudio → transcrição → rascunho)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-02.
> Primeira frente fora do núcleo da CIPA (`docs/specs/fase-12-central-cipa-nucleo.md`
> §1: "frentes futuras, na ordem acordada" — esta é a primeira da lista).
> Depende da Fase 12a (backend) e 12b (frontend) já implantadas em produção.

## 1. Objetivo e escopo

A empresa grava a reunião de CIPA com qualquer aparelho (celular,
gravador) fora do sistema e faz upload do arquivo de áudio na própria
tela da reunião (`/empresa/cipa/reunioes/[id]`, já existente desde a
Fase 12b-2). O sistema transcreve o áudio e usa IA pra gerar um
rascunho dos 3 campos de texto da ata (pauta, discussões,
deliberações) — os mesmos campos que hoje são digitados à mão. A
empresa revisa cada sugestão e decide aplicar ou descartar, campo a
campo; nada é salvo automaticamente. Mesmo fluxo rascunho → aprovação
que já existe — esta fase só adiciona uma forma nova de preencher os
3 campos, não muda o que acontece depois.

**Reaproveitamento:** esta é a segunda integração de IA do projeto
(a primeira é o Copiloto de IA das inspeções, `docs/specs/fase-8-copiloto-ia.md`,
em produção desde 2026-08-28 via OpenRouter/`anthropic/claude-sonnet-5`).
Reaproveita diretamente: o cliente HTTP nativo (`fetch`, sem SDK) já
usado pra chamar o OpenRouter, o padrão de function-calling forçado
pra devolver JSON estruturado, o padrão de UI "IA sugere, humano
aplica" (card de sugestão com Aplicar/Descartar, nunca pré-preenche
controle real silenciosamente, aviso fixo de revisão obrigatória) e a
lição já registrada na revisão final da Fase 8 de wiring de variável
de ambiente nova completo desde o primeiro commit
(`docker-compose.yml`/`.env.example`).

**Peça genuinamente nova:** transcrição de áudio. É a primeira vez que
o produto lida com upload/processamento de áudio. O OpenRouter não
faz transcrição (é um roteador de LLM de texto) — precisa de um
provedor novo só pra esse passo.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Só upload de arquivo já gravado.** Sem gravação ao vivo no
  navegador (sem `MediaRecorder`, sem captura de microfone, sem UI de
  "gravando..."). Reduz escopo drasticamente frente à alternativa.
- **IA extrai só os 3 campos de texto** (pauta, discussões,
  deliberações). Participantes e checklist continuam manuais, mesmo
  fluxo de hoje — nenhuma tentativa de identificar quem falou ou
  marcar itens do checklist automaticamente nesta fase.
- **Processamento assíncrono, sem fila de jobs nova.** Reuniões podem
  passar de 60-90 minutos de áudio — não dá pra travar a tela
  esperando. Mas não introduz BullMQ/Redis-fila: processa em segundo
  plano dentro do próprio processo Node (sem aguardar a resposta
  HTTP), grava status numa tabela, frontend faz polling. Trade-off
  aceito conscientemente: se o container do backend reiniciar no meio
  de um processamento, aquele job se perde sem retry automático — a
  empresa precisa reenviar o áudio. Aceitável dado o volume esperado
  (dezenas de empresas no ano 1, reunião de CIPA não é uso diário).
  Fila de verdade fica candidata pra quando o volume justificar.
- **Áudio original é descartado após a transcrição.** Só o texto da
  transcrição fica guardado (como evidência do que gerou o rascunho);
  o arquivo de áudio em si nunca fica retido — reduz a superfície de
  dado sensível armazenado (voz de pessoas identificáveis é dado
  pessoal sob a LGPD).
- **Transcrição fica visível pra empresa depois**, numa seção
  colapsável "Ver transcrição" na própria tela da reunião — útil se
  alguém questionar depois se a ata reflete bem o que foi dito, já
  que o áudio original não existe mais pra reouvir.
- **Aplicar por campo, não tudo-ou-nada.** Um card de sugestão por
  campo (pauta / discussões / deliberações), cada um com
  Aplicar/Descartar independente — mesmo padrão já validado na Fase 8.
- **Provedor de transcrição: Groq (Whisper large-v3-turbo)**, mesmo
  padrão de interface trocável da Fase 8 (`FieldReportExtractor`) —
  aqui, `AudioTranscriptionService`. Escolhido por custo e velocidade
  (historicamente a opção mais barata do mercado, inferência muito
  mais rápida que tempo real, o que ajuda a UX assíncrona). **Preço
  exato não fica fixado nesta spec** — precisa ser confirmado contra a
  página de preço atual do Groq e validado com uma chamada real antes
  da implementação, mesmo processo que a Fase 8 seguiu (rodar exemplos
  reais, medir custo real, documentar).

## 3. Modelo de dados

Tabela nova, `cipa_meeting_ata_drafts` — satélite de `cipa_meetings`,
mesmo padrão de `cipa_meeting_participants` (não colunas soltas na
tabela principal):

```sql
CREATE TABLE cipa_meeting_ata_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('processando', 'concluido', 'falhou')),
  transcript TEXT,
  draft_pauta TEXT,
  draft_discussoes TEXT,
  draft_deliberacoes TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS espelhando a política de cipa_meetings (tenant_id da sessão).
```

`meeting_id UNIQUE` — um rascunho ativo por reunião. Reenviar um
áudio novo substitui o rascunho anterior (mesma linha, não uma nova).

Os campos `draft_*` só alimentam a UI de sugestão — nunca gravam
diretamente em `cipa_meetings.pauta`/`discussoes`/`deliberacoes`. Só o
clique em "Aplicar" (fluxo já existente, mesmo `PATCH
/cipa/meetings/:id` da Fase 12b-2) grava o campo real.

## 4. Fluxo

1. `POST /cipa/meetings/:id/ata-audio` (multipart, papel `empresa`,
   exige `status_ata === 'rascunho'` na reunião — mesma trava de tudo
   mais editável nesta tela, backend rejeita com 409 se já aprovada).
   Rejeita também se já existe um rascunho `processando` pra essa
   reunião (evita job duplicado rodando ao mesmo tempo) — a checagem e
   a criação/substituição da linha em `cipa_meeting_ata_drafts`
   precisam do mesmo padrão de `SELECT ... FOR UPDATE` que
   `MeetingsService.update`/`setParticipants` já usam pra evitar corrida
   entre dois uploads quase simultâneos na mesma reunião (mesma classe
   de bug que a revisão final da Fase 12a encontrou nesse serviço).
   Valida tipo/tamanho do arquivo (ver seção 6). Salva o áudio temporariamente
   no R2 (não cria linha em `documents` — não é um documento
   permanente, é descartado ao final do processamento). Cria/substitui
   a linha em `cipa_meeting_ata_drafts` com `status: 'processando'`.
   Dispara o processamento em segundo plano (sem `await` na resposta
   HTTP) e responde imediatamente com o estado inicial do rascunho.
2. Processamento em segundo plano (mesmo processo Node):
   a. Chama o `AudioTranscriptionService` (Groq) com o áudio do R2 →
      grava `transcript`.
   b. Chama o extrator de ata via OpenRouter (mesmo padrão de
      function-calling forçado da Fase 8, prompt/schema novos pros 3
      campos) com o texto da transcrição → grava `draft_pauta` /
      `draft_discussoes` / `draft_deliberacoes`.
   c. `status: 'concluido'`.
   d. Em qualquer etapa que falhar: `status: 'falhou'` +
      `error_message` legível.
   e. **Sempre**, sucesso ou falha: apaga o áudio do R2 ao final —
      nunca deixa um arquivo temporário órfão.
3. `GET /cipa/meetings/:id/ata-ai-draft` — devolve o estado atual da
   linha (ou 404 se nunca houve upload pra essa reunião). É o endpoint
   que o frontend faz polling.

## 5. Frontend

Seção nova "🎙️ Gerar ata por áudio" em
`frontend/src/app/empresa/cipa/reunioes/[id]/page.tsx`, visível só
quando `isRascunho` (mesma trava de edição de tudo mais na tela):

- Input de arquivo (`accept="audio/*"`) + botão de upload.
- Ao carregar a página, `load()` também confere se já existe um
  rascunho em `cipa_meeting_ata_drafts` pra essa reunião (não só
  depois de um upload feito na mesma sessão — o processamento pode
  atravessar uma reabertura de aba, já que é assíncrono).
- Enquanto `status === 'processando'`: mensagem "Transcrevendo e
  gerando rascunho... isso pode levar alguns minutos", com polling
  periódico em `GET .../ata-ai-draft` até sair desse estado.
- Quando `status === 'concluido'`: 3 cards de sugestão (pauta /
  discussões / deliberações), cada um com **Aplicar** (grava no campo
  real via o mesmo `patch()` já existente, usuário ainda pode editar
  antes de "Salvar ata") / **Descartar** independente. Aviso fixo, não
  removível: "Sugestão gerada por IA — revise e confirme. Não
  substitui a avaliação do profissional habilitado." (mesmo texto da
  Fase 8, adaptado). Seção colapsável "Ver transcrição" com o texto
  guardado em `transcript`.
- Quando `status === 'falhou'`: mensagem de erro (`error_message`) +
  opção de reenviar o áudio.
- Reenviar áudio numa reunião com rascunho `falhou` ou `concluido`
  substitui o rascunho anterior e tenta de novo.

## 6. Erros, custo e limites

- Upload rejeitado antes de qualquer processamento se o formato não
  for um dos aceitos (mp3/m4a/ogg/wav) ou o arquivo passar de ~250MB /
  ~3h de áudio (número a confirmar contra o limite real de payload do
  `nginx`/`client_max_body_size` antes da implementação — pode exigir
  ajuste de configuração).
- Controle de custo primário: o limite de tamanho/duração acima (o
  custo de transcrição escala com duração do áudio, diferente da Fase
  8 onde o custo por chamada era ~fixo). Secundário: rate limit modesto
  por tenant (a definir no plano — ex.: N uploads/dia), mesmo espírito
  do `AI_DRAFT_RATE_LIMIT` já existente na Fase 8.
- Variáveis de ambiente novas (`GROQ_API_KEY`, mais o que a integração
  exigir) entram corretas no `docker-compose.yml`/`.env.example` desde
  o primeiro commit — lição já registrada na revisão final da Fase 8
  (achado #1: variável de ambiente esquecida no compose).
- `max_tokens` explícito na chamada de extração (mesma lição da Fase 8
  — achado real em produção: sem isso, o pedido tenta usar o teto de
  saída do modelo e pode estourar orçamento).
- Timeout: a chamada de extração usa `AbortSignal.timeout(...)`, mesmo
  padrão já corrigido na Fase 8 pra não colidir com o
  `proxy_read_timeout` do nginx. A chamada de transcrição (Groq) tende
  a ser rápida mesmo pra áudios longos, mas também precisa de timeout
  explícito — como todo o fluxo já é assíncrono (a resposta HTTP do
  upload não espera o processamento terminar), isso protege o processo
  em segundo plano de travar indefinidamente, não a requisição HTTP.

## 7. Testes

Backend: e2e real contra Postgres real (mesmo padrão de todo o
projeto, sem mock de banco), com uma implementação fake de
`AudioTranscriptionService` no ambiente de teste (mesmo padrão
trocável do `FieldReportExtractor`) — testes não fazem chamada paga de
verdade. Cobrir pelo menos: upload cria o rascunho com status
`processando`; processamento (com o fake) chega em `concluido` com os
3 campos preenchidos; ata já aprovada rejeita upload com 409; upload
duplicado enquanto já `processando` é rejeitado; falha do
transcriber/extrator grava `falhou` + mensagem e ainda assim apaga o
áudio do R2; endpoint sem `GROQ_API_KEY` configurada devolve erro
claro (mesmo teste que a revisão final da Fase 8 adicionou pro
OpenRouter). Frontend: sem suíte automatizada (estado real do
projeto), Playwright com sessão sintética + mock de rota, cobrindo os
4 estados (sem rascunho / processando / concluído / falhou) e o caso
de reabrir a página com um job já em andamento.

## 8. Fora de escopo desta fase

- Gravação ao vivo no navegador (frente própria, se algum dia virar
  necessidade real).
- Extração de participantes ou checklist a partir do áudio — só os 3
  campos de texto.
- Fila de jobs de verdade (BullMQ/Redis) — candidata futura se o
  volume de uso justificar.
- Reter o áudio original após a transcrição.
- Editar/regenerar só um campo específico depois que o rascunho já
  chegou em `concluido` (o caminho é sempre reenviar o áudio inteiro).
