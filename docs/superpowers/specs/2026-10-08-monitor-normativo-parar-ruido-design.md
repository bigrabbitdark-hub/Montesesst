# Monitor normativo — parar o ruído e proteger o que está vigente (fatia 1) — design

> Data: 2026-10-08 · Escopo: **só backend** (`backend/src/normative`) · Sem migration · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: análise das telas "Fontes monitoradas" e "Aguardando validação" do admin (`/admin/normativa`). Esta é a fatia 1 de 3; a fatia 2 (tela: diff, lote, "Verificar agora", editar/desativar fonte) e a 3 (envio manual, cadastro em lote, indexação em segundo plano) ficam para depois.

## 1. Problema (dados reais de produção, 2026-10-08, VERIFICADO)

| Fato | Dado |
|---|---|
| Fontes | 51, todas ativas; **7 falham há 7 dias** e nunca geraram documento |
| Documentos | 43 vigentes (todos indexados, 1.789 trechos), 36 substituídos, **9 aguardando validação** |
| Os 9 pendentes | **nenhum é mudança real de norma**: 6 são a mesma fonte (TNU, uma "1ª versão" nova por dia, páginas de portal com carrossel de notícias), 2 são páginas do portal da Imprensa Nacional (as fontes "Base do LTCAT" e "Para acompanhar mudanças", mesma página; 98,9% iguais à vigente, diferem pelo carimbo "Modificado em dd/mm/aaaa hh:mm" **e** por um item de menu novo, "Biblioteca Machado de Assis"), 1 tem **6 caracteres** contra 35.754 da vigente |
| Vigentes de má qualidade já aprovados | **2 documentos "vigentes" com 9 caracteres** (`Portal IN`), de **2 fontes diferentes** com o título "Base do LTCAT" (o índice único permite 1 vigente por fonte), que apontam para `portalin.inss.gov.br`; indexados com 1 trecho cada. As fontes apontam para a página inicial de um portal, não para a norma |
| As 36 trocas já aprovadas | todas com similaridade < 90% (mudanças substanciais): o histórico **não** é de ruído; o ruído é recente |

Causas:
1. `processSource` chama `fetch(url, { signal })` **sem nenhum cabeçalho** (`normative-monitor.service.ts:181`). O `planalto.gov.br` deixa a conexão pendurada com o User-Agent padrão do Node: **5 das 7 fontes** que falham. Testado: com `Mozilla/5.0 (compatible; MonteseSSTMonitor/1.0; +https://montesesst.com.br)` responde 200 em < 2 s; um UA sem o prefixo `Mozilla/5.0` continua falhando. As outras 2 (CAEPI, STF) dão 403 mesmo com cabeçalhos de navegador (fora desta fatia).
2. `recordDetectedVersion` compara o hash do texto **bruto** com a linha mais recente e cria uma nova linha `aguardando_validacao` a cada diferença. Páginas de portal com conteúdo que muda sozinho (carrossel de notícias da TNU; rótulo "Modificado em …" da Imprensa Nacional) geram uma pendente por dia.
3. `buffer.toString('utf-8')` lê todo HTML como UTF-8. As páginas do `planalto.gov.br` vêm em **ISO-8859-1 sem charset declarado** (VERIFICADO): lidas como UTF-8 viram `Presid�ncia da Rep�blica`. É um defeito anterior à fatia, mas só aparece agora porque ela torna essas fontes alcançáveis.
4. Nada impede que uma extração degenerada (6 caracteres) vire pendente, e o botão **Aprovar** a transformaria em vigente, **apagando uma norma boa do Assistente**.

## 2. Decisões

1. **Cabeçalhos do monitor.** Constante `MONITOR_FETCH_HEADERS` com `User-Agent: Mozilla/5.0 (compatible; MonteseSSTMonitor/1.0; +https://montesesst.com.br)` (identifica o robô com honestidade), `Accept` e `Accept-Language: pt-BR`. Sem variável de ambiente nova.
2. **Rótulos voláteis, não similaridade.** `normalizeForComparison(texto)` remove **apenas** rótulos conhecidos que mudam sozinhos, **sensíveis a maiúsculas** (rótulos de portal começam com maiúscula; uma frase jurídica como "será atualizado em 01/01/2027" não é tocada): `Modificado em dd/mm/aaaa [hh:mm]`, `Atualizado em …`, `Última modificação/atualização …`. Duas versões cuja forma normalizada é igual **não** são versão nova. **Não** se usa percentual de similaridade para descartar: uma emenda real a uma NR grande também dá ~99% (ver §5). "Publicado em …" **não** é removido (é conteúdo do ato).
3. **Um pendente por fonte, congelado.** Se a versão mais recente da fonte já é `aguardando_validacao`, o monitor **não escreve nada** (nem cria outra linha, nem altera a existente) e devolve `null`. Depois que o admin aprovar ou rejeitar, a rodada seguinte compara de novo e cria o próximo pendente se houver diferença. *Alternativa descartada na revisão final:* atualizar o pendente no lugar, porque faria o `raw_text` mudar por baixo do revisor (aprovação durante a indexação; aba aberta; rejeitar o ruído A com a linha já em B esconderia uma mudança real). Sem índice único: a escrita concorrente é só o cron noturno **e** as ações do admin, e o congelamento elimina a disputa entre elas.
4. **Barreira de extração suspeita.** Antes de gravar, se o texto extraído tem menos de `MIN_EXTRACTED_CHARS` (100) **ou** menos de 20% do tamanho da versão vigente, a rodada **registra falha da fonte** (`last_error = "Conteúdo suspeito: …"`, contador, e-mail na 2ª falha seguida — o caminho de falha que já existe) e **não cria pendente**. Tamanho é comparado com a vigente, não com pendente.
5. **Codificação correta.** `decodeHtmlBuffer` decide o charset nesta ordem: `Content-Type`, `<meta charset>` nos primeiros 2 KB, UTF-8 estrito, `windows-1252`. A barreira mede o texto **sem** os marcadores de página `-- n of N --` do `pdf-parse` (`meaningfulLength`), para que um PDF escaneado de várias páginas não passe do mínimo só por causa deles.
6. **Sem migration, sem mudança de schema.** `content_hash` continua sendo o SHA-256 do texto bruto; a comparação normalizada é calculada na hora sobre `raw_text` da linha mais recente. Assim o deploy não inunda a fila (um hash novo para as 51 fontes).
7. **A validação humana continua.** Nada é aprovado sozinho. Esta fatia só **deixa de criar** pendentes que são ruído ou lixo; tudo que for diferença real continua exigindo "Aprovar".

## 3. Resultado esperado (primeira rodada das 03:00 depois do release do backend) — INFERIDO, a confirmar em produção

- **5 fontes do `planalto.gov.br` mudam de erro para ok** e produzem 5 pendentes de "primeira versão" (Lei 8.212/91, Lei 8.213/91, Decreto 3.048/99, Decreto 4.882/2003 e a CLT), agora com os **acentos corretos**. É a alimentação funcionando e merece revisão. Aprovar textos grandes (a CLT passa de 1 MB de HTML) gera milhares de chamadas de embedding em sequência: com o OpenRouter sem crédito, a aprovação pode falhar ou demorar (a indexação fica pendente; ver a fatia 3).
- **3 fontes mudam de ok para erro** ("Conteúdo suspeito"): as 2 fontes "Base do LTCAT" (`portalin.inss.gov.br`, vigente de 9 caracteres) e "EPI e custeio" (último texto de 6 caracteres). A barreira roda **antes** da comparação de hash, então uma página que não mudou mas tem menos de 100 caracteres falha **toda noite** (1 e-mail de "falha repetida" na 2ª noite). É o comportamento desejado: uma fonte que não entrega texto aparece como problema em vez de parecer saudável.
- A TNU passa a ter **no máximo 1** pendente novo (os 6 atuais continuam na fila até serem rejeitados; ver §4) e fica evidente que a fonte é um portal.
- Uma página que mude **só** no rótulo "Modificado em …" deixa de gerar pendente. (No caso real do LTCAT houve também um item de menu novo; essa diferença **continua** gerando 1 pendente, e é correto: a regra não decide por percentual. O problema ali é a fonte, ver §4.)
- Uma extração de poucos caracteres vira **falha visível** (badge vermelho "Falhando (n) — Conteúdo suspeito…") e **nunca** vira pendente aprovável.
- Total de fontes falhando: de 7 para 5, com outra composição (CAEPI e STF continuam em 403; 3 novas por conteúdo suspeito).

## 4. Fora de escopo

**Fontes que apontam para páginas de portal** (TNU "Temas representativos"; "Base do LTCAT" e "Para acompanhar mudanças" na Imprensa Nacional; as duas "Base do LTCAT" em `portalin.inss.gov.br`): o monitor não consegue distinguir norma de menu de portal; precisam de URL oficial correta (decisão do proprietário, não minha: não vou inventar URL de norma) e/ou envio manual (fatia 3); os 2 vigentes de 9 caracteres devem ser revisados/rebaixados pelo admin; Tela do admin; seletor de conteúdo por fonte; edição/desativação de fonte; envio manual de arquivo; cadastro em lote; indexação em segundo plano; as 2 fontes com 403 (CAEPI, STF); limpeza dos 9 pendentes atuais (o admin rejeita pela tela com motivo, ou uma limpeza pontual **com autorização**): **a fatia não protege pendentes que já estão na fila**, em especial o de 6 caracteres de "EPI e custeio", que continua aprovável até alguém rejeitá-lo; a mesma barreira também deveria rodar em `prepareApproval` (pendência); comparar também com a vigente quando a mais recente é uma rejeitada.

## 5. Riscos e tratamento

- **Revogação real vira "falha".** Uma norma revogada pode ficar curta; a barreira a trataria como extração suspeita. Mitigação: não é silenciosa (badge e e-mail na 2ª falha com o texto "confira a fonte"); o envio manual da fatia 3 resolve o caso legítimo. Trade-off aceito: preferimos alarme falso a apagar uma norma boa.
- **Normalização esconder mudança real.** Só rótulos de data/hora com prefixo explícito são removidos; teste prova que "Publicado em …" e outras datas permanecem, e a verificação com dados reais confirma que **nenhuma** das 36 trocas históricas fica "igual" depois de normalizar.
- **Pendente congelado fica desatualizado** se a página mudar enquanto espera revisão. Aceito: o revisor decide sobre o texto que de fato leu; a diferença nova só aparece como novo pendente depois da decisão. O ruído diário da TNU deixa de acumular.
- **Pendentes legados (2 ou mais por fonte, ex.: 6 da TNU):** "a mais recente" é `ORDER BY created_at DESC LIMIT 1`; os mais antigos continuam aprováveis até serem rejeitados, e rejeitar só o mais novo faz a próxima diferença criar um novo. Exige limpeza (rejeitar com motivo) uma vez.
- **Dependência de release:** é backend; produção hoje roda `0969bb7-esocial-wip2` (eSocial não commitado). Só entra num release do backend feito depois do commit/merge do eSocial; **numeração de migrations não é afetada** (esta fatia não tem).
- **e2e existentes** (`normative-monitor.e2e-spec.ts`) usam páginas de teste de ~25–31 caracteres, que a nova barreira recusa: o plano alonga esses fixtures. e2e usam o banco (não rodam neste shell): rodar só pela receita de ambiente isolado já validada (`reference_ensaio_descartavel_isolado`), com autorização.

## 6. Verificação

Testes unitários sem banco (utilitário, `recordDetectedVersion` com cliente falso, monitor com `fetch` simulado); `tsc`; suíte unitária comparada com o HEAD limpo (8 suítes já falham lá e não são desta fatia); **verificação somente leitura com dados reais**: as 9 pendentes atuais e as 36 trocas históricas passadas pelo código novo; e2e do monitor no ambiente isolado.

## 7. Git e release

Sem commit, push ou deploy automáticos (AGENTS.md). Release do backend só com autorização, em worktree limpa, depois do eSocial.

## 8. Resultado da verificação (2026-10-08, estado final após a revisão final)

- **Testes unitários da fatia:** `normative-text`, `normative-record-detected-version` e `normative-monitor-guard`: 3 suítes, 36 testes, todos passam. `tsc --noEmit` do backend limpo.
- **Suíte unitária inteira, HEAD limpo + só esta fatia vs HEAD limpo (HEAD `99afff8`):** conjunto de falhas **idêntico** (8 suítes e 20 testes, pré-existentes: `company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`); **598 testes passando** contra 559 no HEAD. Na árvore de trabalho completa o conjunto oscila sozinho (`pente-fino-controller`, `sst-audit-*`, `tenant-context-callsites`) por WIP de outra frente em `backend/src/pente-fino/*`, que esta fatia não toca.
- **Simulação com dados reais de produção (somente `SELECT`), código final:** **0 das 36** trocas históricas seriam escondidas pela normalização (já sem a flag `i`); dos 9 pendentes atuais, **1 é barrado** ("EPI e custeio", 6 caracteres contra 35.754). Os 2 do LTCAT (carimbo **e** item de menu novo) e os 6 da TNU seguem fora do alcance da normalização; com o congelamento, nenhum pendente novo nasce para essas fontes enquanto os atuais esperarem revisão.
- **Revisão final (modelo mais capaz) achou, e esta spec/código já corrigem:** (1) atualizar o pendente no lugar permitia aprovar/rejeitar texto não lido, agora o pendente é **congelado**; (2) as 5 fontes do Planalto vêm em ISO-8859-1 sem charset (**VERIFICADO**) e seriam gravadas com acentos corrompidos, agora há `decodeHtmlBuffer`; (3) a spec não previa as 3 fontes que passam de ok para erro; (4) marcadores `-- n of N --` do PDF contavam como texto; (5) a flag `i` removia "atualizado em <data>" de frases jurídicas.
- **NÃO VERIFICADO:**
  - o **e2e** do monitor (usa banco; só no ambiente isolado, com autorização). Foi reescrito e **simulado linha a linha** por revisores, mas nunca executado;
  - o efeito real dos cabeçalhos e da decodificação sobre o `planalto.gov.br` dentro do monitor (testado só com `curl` e com `fetch` simulado);
  - PDFs (a barreira com `meaningfulLength` tem teste de unidade, mas não há teste ponta a ponta com PDF escaneado);
  - o custo e o crédito da indexação ao aprovar textos grandes (a CLT passa de 1 MB de HTML).
- **Pendências (fora desta fatia):** rejeitar pela tela os 9 pendentes atuais com motivo (a fatia não protege o que já está na fila: o de 6 caracteres continua aprovável); rodar a barreira também em `prepareApproval`; comparar também com a vigente quando a mais recente é uma rejeitada; pendentes legados (2 ou mais por fonte); proteção contra duas rodadas simultâneas do monitor; as fontes que apontam para portais (TNU, LTCAT, "EPI e custeio") precisam de URL oficial correta (decisão do proprietário).
