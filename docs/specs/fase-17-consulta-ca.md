# Fase 17 — Consulta de CA (base oficial CAEPI/MTE)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-03.
> Quinta frente fora do núcleo da CIPA (`docs/specs/fase-12-central-cipa-nucleo.md`
> §1: "frentes futuras, na ordem acordada" — o item original do roadmap
> ("Consulta de CA, Documentos Técnicos (LTCAT/LIP)") junta dois
> assuntos numa frase só; esta spec cobre só a primeira metade —
> Documentos Técnicos (LTCAT/LIP) vira uma frente própria separada,
> bem menor (categorias novas no módulo de documentos já existente).
> A visão mais ampla trazida no brainstorming (agente de IA pra
> interpretar o CA, reorganização do menu em "Gestão de EPIs" com
> associação do CA consultado ao cadastro) foi deliberadamente
> deixada fora desta fase — ver seção 6.

## 1. Objetivo e escopo

Hoje, ao cadastrar um EPI (`tenant_epis`, desde a Fase 6), a empresa
digita o número do CA (Certificado de Aprovação) e sua validade
manualmente — sem nenhuma verificação contra a fonte oficial. Esta
fase entrega uma consulta real desses dados: um espelho local,
sincronizado periodicamente, da base pública que o Ministério do
Trabalho e Emprego (MTE) disponibiliza pra download através do
sistema CAEPI, com uma tela de busca pra empresa e técnico
consultarem qualquer CA.

## 2. Pesquisa técnica (spike, feita antes desta spec)

Investigação feita com download real e inspeção direta do arquivo
(não é informação de segunda mão):

- **Fonte real, viva, pública**: `ftp://ftp.mtps.gov.br/portal/fiscalizacao/seguranca-e-saude-no-trabalho/caepi/tgg_export_caepi.zip`,
  acesso anônimo, sem autenticação. Confirmado no ar em 2026-09-03,
  arquivo datado do próprio dia (atualização diária, conforme a
  documentação oficial do MTE já indica).
- **Formato real**: dentro do zip, um único arquivo texto
  (`tgg_export_caepi.txt`) separado por `|`, codificado em UTF-8
  (**correção**: uma primeira tentativa deste spike assumiu
  Windows-1252, baseada num texto de pesquisa colado pelo fundador de
  origem não verificada — testei as três hipóteses de encoding
  lado a lado contra os bytes reais baixados do servidor, e só UTF-8
  produz texto correto, ex. "CINTURÃO TIPO PÁRA-QUEDISTA", "PROTEÇÃO
  DO USUÁRIO"; Windows-1252 e Latin-1 produzem caracteres corrompidos
  como "CINTURÃƒO"/"USUÃ�RIO"). Cabeçalho e colunas confirmados por
  inspeção direta:
  `NR Registro CA|DATA DE VALIDADE|SITUACAO|NR DO PROCESSO|CNPJ|RAZAO SOCIAL|NATUREZA|EQUIPAMENTO|DESCRICAO EQUIPAMENTO|MARCA CA|REFERENCIA|COR|APROVADO PARA LAUDO|RESTRICAO LAUDO|OBSERVACAO ANALISE LAUDO|CNPJ LABORATORIO|RAZAO SOCIAL LABORATORIO|NR LAUDO|NORMA`.
  `SITUACAO` é um enum em português confirmado com valores reais:
  `VÁLIDO`, `VENCIDO`, `SUSPENSO`, `CANCELADO`.
- **Achado importante — o ZIP do próprio governo vem malformado.**
  Falta o registro de fim do índice central (End of Central
  Directory) que todo ZIP padrão precisa ter — ferramentas padrão
  (`unzip`, `zipfile` do Python, e presumivelmente qualquer biblioteca
  de zip padrão em Node) falham ao abrir esse arquivo direto. Só foi
  possível ler o conteúdo fazendo parsing manual do cabeçalho local
  do primeiro (e único) arquivo dentro do zip, seguido de
  descompressão bruta (`raw deflate`, sem esperar o rodapé do zip) —
  abordagem validada no spike, extraindo ~65 mil linhas reais de
  teste com sucesso. **O importador desta fase precisa nascer com
  esse parsing defensivo, não é um caso extremo hipotético** — no
  teste do próprio spike, o arquivo do dia veio cortado no meio de um
  registro antes do fim, então o importador também precisa descartar
  silenciosamente (só logar, não falhar) a última linha se ela não
  tiver o número certo de colunas.

## 3. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Escopo desta fase é só sincronizar + buscar.** Sem associar o CA
  consultado a um EPI já cadastrado (`tenant_epis`) — fica só consulta
  informativa. Sem agente de IA pra interpretar/alertar sobre o
  resultado — mesma razão já usada pra adiar o Copiloto da Fase 8
  (só ativar quando o fundador tiver uma chave de API real e pedir
  explicitamente). Sem reorganizar o menu de EPI num grupo "Gestão de
  EPIs" — o link novo entra ao lado do link "EPIs" já existente, sem
  reestruturar mais nada da sidebar.
- **`caepi_records` é dado público global, não é dado de tenant.** É
  um espelho de uma base do governo, igual pra qualquer empresa —
  diferente de toda tabela criada nas fases anteriores desta sessão
  (fases 12-16, todas CIPA e todas com RLS), **não leva `tenant_id` e
  não tem RLS**. **Correção (achada na revisão final desta fase)**: já
  existe precedente real no projeto pra esse padrão fora desta sessão
  — `epi_catalog_items` (migration 0013, Fase 6) e
  `official_sources`/`normative_documents` (migration 0021, Fase 9)
  também são dado de referência compartilhado sem `tenant_id`/RLS,
  pelo mesmo motivo. Não é uma exceção inédita no projeto, só inédita
  entre as fases CIPA feitas nesta sessão — mas segue exatamente o
  padrão já estabelecido, não abre precedente novo. Qualquer usuário
  autenticado
  com papel `empresa`/`tecnico`/`parceiro` pode consultar (mesmo
  conjunto de papéis já usado no módulo de EPI hoje).
- **Sincronização é um script rodado manualmente por quem opera o
  servidor**, mesmo padrão já usado pra `npm run db:migrate`. **Nota de
  precisão**: diferente do que ficou repetido em fases anteriores
  desta sessão, este projeto não é livre de scheduler — já existe
  `@nestjs/schedule` (`ScheduleModule.forRoot()` em `app.module.ts`)
  rodando um `@Cron` diário de lembrete de visita
  (`VisitReminderCronService`) e um monitor normativo. A escolha de
  script manual aqui não é "porque não existe scheduler no projeto" —
  é porque uma importação de potencialmente centenas de milhares de
  linhas merece controle explícito de quando roda (mesmo raciocínio de
  rodar uma migration manualmente), e não expor uma rota HTTP nova que
  dispare essa operação pesada a qualquer usuário autenticado sem
  controle. Automatizar via `@Cron` fica como evolução natural futura,
  se a sincronização manual se mostrar incômoda na prática.
- **Sem índice de busca textual sofisticado (full-text search) nesta
  fase.** Busca livre via `ILIKE` simples é suficiente pro volume de
  uso esperado (consulta manual ocasional, não uma rota de alto
  tráfego) — otimização de índice fica pra depois, só se virar
  necessidade real.

## 4. Modelo de dados

```sql
CREATE TABLE caepi_records (
  numero_ca TEXT PRIMARY KEY,
  data_validade DATE,
  situacao TEXT,
  numero_processo TEXT,
  cnpj TEXT,
  razao_social TEXT,
  natureza TEXT,
  equipamento TEXT,
  descricao_equipamento TEXT,
  marca_ca TEXT,
  referencia TEXT,
  cor TEXT,
  aprovado_laudo TEXT,
  restricao_laudo TEXT,
  observacao_laudo TEXT,
  cnpj_laboratorio TEXT,
  razao_social_laboratorio TEXT,
  numero_laudo TEXT,
  norma TEXT,
  -- Sem trigger set_updated_at() (padrão do resto do projeto) de
  -- propósito — a única gravação nesta tabela é o upsert em lote do
  -- script de sincronização, que já sabe o timestamp exato e grava
  -- explicitamente no SET do próprio upsert. Um trigger disparando em
  -- cada uma de até centenas de milhares de linhas por sincronização
  -- seria overhead sem propósito real aqui.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha só (id fixo), sempre substituída por upsert — guarda
-- quando a última sincronização rodou, pra exibir na tela de busca
-- ("última atualização da base em DD/MM/AAAA").
CREATE TABLE caepi_sync_status (
  id INT PRIMARY KEY DEFAULT 1,
  last_synced_at TIMESTAMPTZ NOT NULL,
  rows_imported INT NOT NULL,
  rows_skipped INT NOT NULL,
  CONSTRAINT chk_single_row CHECK (id = 1)
);
```

Sem RLS em nenhuma das duas tabelas — dado público, não pertence a
nenhum tenant.

## 5. Fluxo

### 5.1 Sincronização (script)

`npm run caepi:sync` (script novo em `backend/`, não uma rota HTTP):

1. Baixa `tgg_export_caepi.zip` do FTP público do MTE.
2. Faz o parsing manual do cabeçalho local do zip + descompressão
   bruta (`raw deflate`) — não usa uma lib de zip padrão, que falha
   nesse arquivo (seção 2).
3. Processa linha por linha (separador `|`, o texto descomprimido já
   é UTF-8 — sem conversão de encoding necessária), pulando (e
   contando) qualquer linha que não tenha o número certo de colunas —
   inclusive a última linha, se vier cortada.
4. Faz upsert em lote em `caepi_records` (`INSERT ... ON CONFLICT
   (numero_ca) DO UPDATE`), chaveado por `numero_ca`.
5. Atualiza `caepi_sync_status` com o timestamp, total importado e
   total pulado.
6. Imprime um resumo no terminal (linhas processadas/importadas/
   puladas, tempo total).

### 5.2 Consulta (API + tela)

Um único endpoint de busca cobre os dois casos de uso (número exato
de CA ou termo livre) — sem lógica no frontend decidindo qual rota
chamar:

1. `GET /caepi/search?q=<termo>` — `q` pode ser um número de CA
   completo ou um termo livre. A consulta SQL busca `numero_ca = $1`
   **ou** `ILIKE` em `equipamento`/`descricao_equipamento`/
   `marca_ca`/`razao_social`, com o resultado ordenado pra priorizar
   um match exato de `numero_ca` primeiro (`ORDER BY (numero_ca = $1) DESC`),
   resultado limitado (ex. 50 registros).
2. `GET /caepi/sync-status` — devolve `last_synced_at`/`rows_imported`.
3. Tela nova (`/empresa/consulta-ca`, `/tecnico/consulta-ca`) — um
   campo de busca só, chamando sempre `GET /caepi/search`, lista de
   resultados com badge de situação (verde `VÁLIDO`, amarelo
   `SUSPENSO`, vermelho `VENCIDO`/`CANCELADO` — mesma linguagem visual
   de badge já usada em outras telas deste projeto), mostrando
   equipamento, descrição, fabricante (razão social), validade e
   norma. Rodapé da tela mostra "Base atualizada em
   {last_synced_at}".

## 6. Fora de escopo desta fase

- Associar um CA consultado a um EPI já cadastrado
  (`tenant_epis`) — a consulta é só informativa.
- Agente de IA pra interpretar/alertar sobre o resultado da consulta
  — candidato a frente futura, mesma decisão já tomada pra Fase 8
  (Copiloto), só ativar com uma chave de API real.
- Reorganização da sidebar num grupo "Gestão de EPIs" — o link novo
  entra isolado, ao lado do link "EPIs" já existente.
- Documentos Técnicos (LTCAT/LIP) — segunda metade do item original
  do roadmap, vira uma frente própria separada e bem menor (só
  categorias novas no módulo de documentos já existente, sem relação
  técnica com esta fase).
- Sincronização automática/agendada — o script é sempre disparado
  manualmente nesta fase.
- Rota HTTP que dispare a sincronização — só o script de linha de
  comando.
- Alertas automáticos (ex. "CA cadastrado pela empresa não bate com o
  que a base oficial diz") — a consulta e o cadastro de EPI continuam
  desconectados nesta fase (ver primeiro item desta lista).
