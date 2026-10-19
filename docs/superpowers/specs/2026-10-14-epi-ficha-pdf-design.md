# Módulo EPI — Subsistema 2: ficha de controle e PDF (design)

Data: 2026-10-14. Status: **implementado e testado no ensaio; não commitado** (documentação técnica: `docs/architecture/epi-ficha.md`). O texto abaixo é a spec original, com as correções marcadas e a seção final "Decisões e desvios da implementação".
Rótulos: VERIFICADO (lido no código), RECOMENDADO (proposta), NÃO VERIFICADO.
Depende do subsistema 1 (livro de movimentações, migration 0081), implementado em `/opt/montese-epi`, branch `feat/epi-estoque`.

## Escopo

Entrega, no backend: dados da ficha por funcionário a partir das movimentações reais, prévia em PDF, **emissão** de versões numeradas e imutáveis, download e verificação de integridade. Inclui a coluna `department` (setor) em `employees`; a matrícula (`registration_number`) já existia (ver CORREÇÃO DA SPEC abaixo).

Fora de escopo: assinatura eletrônica e imagem de assinatura (subsistema 3); telas, menu e dashboard, incluindo o formulário de funcionário (subsistema 4); página pública de verificação; certificação ICP-Brasil (não alegar).

## Estado atual (VERIFICADO)

- `pdfkit` já é usado (`inspections/inspection-pdf.util.ts`, `cipa/ata-pdf.util.ts`). `R2Service`: `putObject`, `getObject`, `getPresignedDownloadUrl`, `deleteObject`; chaves por empresa em `tenants/<tenantId>/...`.
- Logos da marca em `frontend/public/brand/` (`logo-horizontal-transparente.png` etc.): o backend não os enxerga; precisam de cópia em `backend/assets/brand/`. A foto de EPIs enviada pelo proprietário (anexo desta conversa) pode compor a capa/cabeçalho; só entra se o arquivo for fornecido como arquivo (NÃO VERIFICADO: existe apenas na conversa).
- `tenants`: `name`, `trade_name`, `cnpj`, endereço em campos, `logo_file_key`. `employees`: `full_name`, `cpf`, `position`, `position_id`, `admission_date`, `company_unit_id`. ~~Não há matrícula nem setor.~~ **ERRO DESTA SPEC (corrigido):** `registration_number` já existe desde a migration 0069 (eSocial); só o setor não existia. Foi olhada só a 0080.
- A migration `0080` (branch `feat/tabela-oficial-funcionarios`) cria `sex`, `cbo_code`, `activity_description`. Atualização 2026-10-19 (merge com a tabela oficial): `esocial_registration` foi removida; `registration_number` é a única matrícula, e a 0080 só acrescenta formato e unicidade sobre ela.

## Decisões do proprietário (2026-10-14)

1. **Prévia x emissão**: visualizar/imprimir é prévia (marcada "NÃO EMITIDO", sem registro); "Emitir ficha" grava uma versão oficial numerada e imutável (R2 + SHA-256 + instantâneo dos dados + autor). Cada emissão é a versão seguinte; as anteriores continuam verificáveis.
2. **Matrícula e setor**: usar em `employees` a matrícula e o setor. Faltando valor, a ficha imprime "não informado". **CORREÇÃO DA SPEC:** esta decisão foi tomada pelo proprietário com a premissa errada de que a matrícula não existia e seria criada; `registration_number` já existe desde a 0069 (eSocial). Só `department` foi criado (0082). O efeito prático da decisão (a ficha mostra matrícula e setor) se mantém; a diferença é que a matrícula é compartilhada com o módulo eSocial.
3. **Verificação**: código no rodapé + verificação autenticada (sem rota pública).
4. **CPF mascarado** por padrão no PDF e na ficha (`***.456.789-**`) — RECOMENDADO, a confirmar na revisão desta spec.
5. **Rodapé de marca** (fornecido pelo proprietário em 2026-10-14, PNG 3200×672 px, VERIFICADO): faixa "Equipe Montese SST — Tecnologia que organiza | Gestão que protege — contato@montesesst.com.br — Antes de imprimir, pense no meio ambiente". Aplicada em **todas as páginas** do PDF da ficha, na largura total da página A4 (proporção mantida: ≈ 125 pt de altura), com a linha técnica (código, versão, página X de Y, prefixo do hash) logo acima dela. O e-mail e os textos fazem parte da imagem: não são gerados nem validados pelo sistema.
   - Origem do arquivo: arquivo fornecido pelo proprietário (imagem `2.png`, 1024×606, junto da foto de EPIs `1.jpg`). Ambos precisam ser copiados para o repositório: **não commitar nada** sem o proprietário.
   - Destino: `backend/src/common/pdf/assets/` (`montese-footer.png`, e o logo e a foto quando usados), copiados para o `dist` pelo `nest-cli.json` (precedente: `esocial/schemas/**/*.xsd`), **sem alterar o Dockerfile**.
   - Implementado como helper reutilizável (`common/pdf/brand-footer.util.ts`), para que os demais PDFs do sistema (relatório de visita, ata da CIPA) possam adotá-lo depois. **Aplicá-lo aos PDFs existentes é decisão separada do proprietário** (muda módulos fora deste subsistema) e fica fora do escopo.

## Abordagem

`pdfkit` no servidor, arquivo emitido guardado byte a byte no R2. Rejeitadas: HTML→PDF com Puppeteer (dependência pesada e mudança de imagem de produção) e re-renderização a cada consulta (a atualização do `pdfkit` mudaria os bytes e quebraria o hash).

## Modelo de dados (migration 0082; numeração a confirmar)

Aditiva.

**`employees`**: só `department TEXT` é novo (nulo, CHECK ≤ 120). `registration_number` já existia (0069). Tamanho, tipo e NUL são validados no serviço do employees (os DTOs só têm `@Allow()`); a importação fica fora de escopo.

**`epi_ficha_documents`** (imutável):
`id`, `tenant_id`, `employee_id` (FK RESTRICT), `version` (int ≥ 1), `document_code` (texto único legível, ex.: `FEPI-AAAAMMDD-xxxxxx`), `file_key`, `file_sha256` (hex 64), `snapshot_sha256` (hex 64), `snapshot` (JSONB: empresa, funcionário, linhas do histórico, filtros usados, versão do termo, status de assinatura de cada linha), `term_version`, `issued_by_user_id`, `issued_at`, `idempotency_key`.
- `UNIQUE (tenant_id, employee_id, version)` e `UNIQUE (tenant_id, idempotency_key)`; `UNIQUE (tenant_id, document_code)`.
- Trigger de imutabilidade (mesmo padrão da 0081: UPDATE nunca; DELETE direto nunca; cascata de tenant permitida via `epi_tenant_row_exists`), `REVOKE TRUNCATE ... FROM montese_app`, RLS + FORCE RLS com a policy padrão do módulo, índices por `tenant_id` e por funcionário.
- A numeração da versão é calculada sob `SELECT ... FOR UPDATE` no funcionário (ou advisory lock), para emissões concorrentes não gerarem a mesma versão.

## Regras

- **Ficha**: lista cronológica de `entrega`, `troca` e `devolucao` do funcionário no livro, com descrição do EPI, CA, quantidade, data, motivo e status de assinatura. Movimentações estornadas aparecem como tal (nunca somem). Entregas do fluxo legado entram como "histórico anterior ao módulo", sem quantidade inventada. Nada é gravado ao consultar.
- **Filtros**: período (`from`/`to`, mesmo formato validado do subsistema 1) e situação da assinatura. Os filtros usados entram no instantâneo.
- **Dados históricos não mudam**: descrição/CA exibidos na ficha vêm do EPI no momento da consulta, mas o instantâneo emitido congela o que foi impresso; editar o cadastro depois não altera documento emitido.
- **Emissão**: exige idempotency_key; mesma chave devolve o mesmo documento (200), com comparação de funcionário e filtros. Registra autor, data, versão e hashes. Falha na gravação do R2 ou do registro desfaz tudo (sem documento pela metade): gravar o arquivo no R2, depois o registro; se o registro falhar, remover o arquivo órfão.
- **Hashes**: `file_sha256` = SHA-256 dos bytes do PDF guardado; `snapshot_sha256` = SHA-256 da forma canônica do JSON do instantâneo. O rodapé imprime código, versão, "página X de Y" e o prefixo do `snapshot_sha256`; o hash do arquivo não pode constar dentro dele e fica no sistema.
- **Verificação autenticada**: recalcula o SHA-256 do arquivo guardado no R2 e compara com `file_sha256`; opcionalmente compara com um PDF enviado. Resposta: íntegro | divergente | arquivo ausente. Sem rota pública.
- **Assinatura**: sem confirmação registrada, o PDF não contém imagem de assinatura nem selo; o status aparece como Pendente, Recusada, Expirada, Registrada presencialmente ou Legado, conforme `signature_status` da entrega. Nada é alegado como ICP-Brasil.
- **Termo de recebimento e responsabilidade**: texto versionado em código (`term_version`), marcado como RASCUNHO A REVISAR pelo proprietário/jurídico. Não cita norma, artigo ou prazo. O PDF imprime a versão do termo usada.
- **CPF**: mascarado no JSON de resposta, no instantâneo e no PDF por padrão.
- **PDF**: A4, margens consistentes, cabeçalho e rodapé repetidos em todas as páginas (rodapé = faixa de marca da decisão 5, que reduz a área útil de cada página em ≈ 125 pt + linha técnica; a paginação precisa descontar isso), múltiplas páginas, tabela com quebra, logo Montese e dados reais da empresa (razão social, CNPJ, endereço), identificação do funcionário (nome, matrícula, setor, função), data de emissão e identificador do documento. Marca "NÃO EMITIDO" na prévia.

## API (módulo novo `epi-ficha`, sob `/epi-fichas`)

- `GET /epi-fichas/employees/:employeeId` — ficha em JSON (CPF mascarado), com filtros.
- `GET /epi-fichas/employees/:employeeId/preview.pdf` — prévia (não grava).
- `POST /epi-fichas/employees/:employeeId/issue` — emite; corpo: `idempotency_key`, filtros; 201 novo / 200 repetição.
- `GET /epi-fichas/employees/:employeeId/documents` — lista de versões emitidas.
- `GET /epi-fichas/documents/:documentId/download` — entrega o PDF pelo backend (sem URL pública).
- `GET /epi-fichas/documents/:documentId/verify` — verificação; `POST` com PDF enviado fica fora do primeiro corte (RECOMENDADO) a menos que o plano o inclua com limite de tamanho.
- Papéis: `empresa`, `tecnico`, `parceiro` (vinculados) e `admin` consultam, baixam e emitem; vínculo por RLS. DTOs com `whitelist` + `forbidNonWhitelisted`; ids com `ParseUUIDPipe`; nenhuma entrada inválida vira 500 (regra aprendida no subsistema 1). `AuditInterceptor` global audita a emissão; sem CPF em logs.
- Rate limit padrão do sistema; geração de PDF não deve bloquear o event loop por tempo excessivo (limite de linhas por documento a definir no plano).

## Testes (ensaio descartável)

Ficha só a partir de movimentações reais (incluindo estornadas e legado); filtros; prévia sem registro; emissão e numeração de versões, inclusive concorrente; idempotência; imutabilidade (UPDATE/DELETE/TRUNCATE); isolamento entre empresas e técnico não vinculado; permissões; PDF sem assinatura e com "registrada presencialmente"; ausência de imagem/selo sem confirmação; CPF mascarado; hash do arquivo confere e arquivo adulterado → divergente; arquivo ausente no R2 → ausente; falha de R2 não deixa registro; regressão do subsistema 1.

## Riscos e pontos em aberto

- Texto do termo depende de revisão do proprietário/jurídico; sem ela, a emissão pode ser feita apenas como rascunho — decidir se a emissão fica bloqueada até o termo ser aprovado (RECOMENDADO: permitir, com o termo impresso como "rascunho" até aprovação).
- Colisão de numeração de migration (0082 depende da ordem de release; `0080` em outra branch).
- Retenção: documentos emitidos e funcionário com ficha não podem ser apagados (RESTRICT); decisão LGPD do proprietário.
- Rodapé e foto: os arquivos foram fornecidos (2.png e 1.jpg, ver decisão 5) e entram em `backend/src/common/pdf/assets/`; o logo horizontal sai de `frontend/public/brand/logo-horizontal-transparente.png`. O PNG do rodapé tem ≈ 410 KB: avaliar tamanho do PDF (cada PDF embute a imagem uma vez; `pdfkit` reutiliza a mesma imagem entre páginas) e, se necessário, otimizar sem perder legibilidade (decisão do plano).
- Dependência do subsistema 1 não mesclada (branch `feat/epi-estoque`): o worktree do subsistema 2 parte dela.
- `delivered_at` do fluxo legado usa o fuso do banco (pendência do subsistema 1): corrigir no início deste subsistema, pois a ficha ordena por data.
- ~~Nada deste subsistema foi implementado nem testado.~~ Implementado e testado no ensaio descartável; não commitado.

## Critérios de aceitação

1. Ficha reflete só movimentações reais; estornadas e legado identificados.
2. Prévia nunca grava; emissão grava versão numerada imutável, concorrência segura.
3. PDF A4 legível, multipágina, com identidade Montese, dados reais, termo (rascunho), status de assinatura sem selo falso.
4. Hash do arquivo guardado confere; adulteração detectada; documento antigo permanece verificável após mudar o cadastro.
5. Isolamento entre empresas e permissões comprovados por testes; testes dos subsistemas anteriores continuam verdes; build e typecheck limpos.

## Decisões e desvios da implementação

Status: **implementado e testado no ensaio; não commitado.** Detalhes e testes em `docs/architecture/epi-ficha.md`. Rótulos: VERIFICADO (código/testes), RECOMENDADO.

1. **Erro da spec sobre a matrícula**: `employees.registration_number` já existia desde a 0069; só `department` é novo na 0082. A decisão 2 do proprietário foi tomada com a premissa errada. Rulings: não criar CHECK de tamanho em `registration_number` no banco (a coluna é do eSocial também); o limite de 30 caracteres fica **no serviço do employees** (coerente com o eSocial); `department` tem CHECK ≤ 120 no banco e a mesma validação no serviço.
2. **`document_code`**: `FEPI-AAAAMMDD-XXXXXXXX` (8 hex maiúsculos aleatórios; data no fuso America/Sao_Paulo). A spec previa `xxxxxx`; o formato mudou depois da revisão (colisão de código). Colisão -> 409 sem apagar o arquivo original.
3. **Chave do R2 com UUID**: `tenants/<tenant>/epi-fichas/<funcionário>/v<versão>-<UUID>.pdf`. Antes a chave dependia do código; uma colisão de código poderia apagar o PDF de um documento emitido.
4. **Normalização de `occurred_at`** (subsistema 1, `registerMovement`): data pura = meio-dia de São Paulo; datetime sem offset = horário de São Paulo; com `Z`/offset inalterado. Sem isso a data pura caía no dia anterior em São Paulo (afetava `delivered_at` e a ficha). Custo se errado: clientes que enviavam datetime sem offset esperando UTC veem 3 h de diferença. `delivered_at` do livro passou a usar America/Sao_Paulo. A rota legada `POST /epis/:id/deliveries` continua gravando `delivered_at` no fuso do banco (só o fluxo do livro foi corrigido).
5. **Trava `FOR NO KEY UPDATE` + timeouts**: a numeração de versão é calculada sob `SELECT ... FOR NO KEY UPDATE` no funcionário (serializa emissões sem bloquear entregas). `lock_timeout` (`EPI_FICHA_LOCK_TIMEOUT_MS`, padrão 5000) -> 503; PUT ao R2 com timeout (`EPI_FICHA_R2_TIMEOUT_MS`, padrão 8000) -> 502; exclusão best-effort também limitada. `R2Service` global não foi alterado. Consequência: PUT tardio ou falha de COMMIT podem deixar objeto órfão no R2; reconciliação RECOMENDADA, não implementada.
6. **`signature_status` do livro só para entrega/troca na ficha**: vem da entrega vinculada; devolução e estorno têm status nulo e saem do resultado quando o filtro de situação é usado.
7. **DTOs de employees com validadores reais**: `CreateEmployeeDto`/`UpdateEmployeeDto` não tinham decorators e o `ValidationPipe` global rejeita todas as propriedades de um DTO assim (provado em e2e com `configureApp`). Uma primeira versão usou `@Allow()`, mas isso liberava 500 novos (CPF repetido, máscara, datas, enum, UUID, NOT NULL); a versão final usa validadores de class-validator e traduz erros do Postgres no serviço (ver `epi-ficha.md`, seção 12). Possível bug preexistente em produção, NÃO VERIFICADO; ver "Achado fora do escopo" em `epi-ficha.md`.
8. **Limite da matrícula = 30** no serviço do employees (ver item 1).
9. **Rodapé de marca (decisão 5)**: implementado em `common/pdf/brand-footer.util.ts`, em todas as páginas da ficha, com linha técnica acima; ativos em `backend/src/common/pdf/assets/` copiados pelo `nest-cli.json`, sem alterar o Dockerfile. Adoção nos demais PDFs segue decisão separada. A foto `1.jpg` não foi usada. O PDF ficou com ~780 KB (logo 365 KB + rodapé 410 KB); reduzir é decisão do proprietário.
10. **Limite de 1000 linhas por ficha** (400 acima), definido na implementação (a spec deixava "a definir").
11. **Verificação**: apenas `GET .../verify` (íntegro | divergente | arquivo_ausente); a verificação com PDF enviado ficou fora do primeiro corte (POST -> 404).
