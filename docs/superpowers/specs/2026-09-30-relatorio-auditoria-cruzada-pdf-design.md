# Relatório Completo de Auditoria Cruzada SST — Design

**Status:** proposta para revisão do usuário
**Data:** 2026-09-30

## Objetivo

Evoluir a Auditoria Montese para produzir, a partir de PGR, LTCAT, PCMSO e LIP, um relatório cruzado rastreável na tela e em PDF. O PDF seguirá a estrutura e hierarquia do modelo Durant recebido, usará o logo Montese SST e só apresentará conclusões sustentadas por fatos extraídos e regras aplicáveis verificadas.

## Decisões aprovadas

- A primeira entrega deve atender ao relatório completo, não publicar um PDF reduzido como se fosse uma auditoria integral.
- Arquitetura única composta por extração estruturada/page-aware, cruzamento e regras normativas verificáveis, seguida da montagem do relatório/PDF.
- Cada fato permanece ligado ao arquivo de origem, página e trecho literal; afirmação documental, evidência, regra e inferência são categorias distintas.
- Uma NC exige evidência documental direta, requisito aplicável na data da análise e comparação objetiva. Divergências sem explicação são inconsistências/a esclarecer, não automaticamente erro ou NC.
- A auditoria permanece na tela e oferece um botão explícito para baixar o PDF do mesmo resultado. O PDF não é arquivado automaticamente nem recebe assinatura digital.
- Identificador do relatório é rastreabilidade, não código de validação ou certificação.
- Manter autenticação, contexto de tenant oriundo do JWT, RLS/FORCE RLS, autorização de técnico/parceiro vinculado, limites de execução e provider MiniMax atual.

## Contexto verificado

- `POST /pente-fino/run` já cruza extrações função/risco do PGR com função/exame do PCMSO, checklist limitado de data/profissional e agentes do LIP/LTCAT. O resultado aditivo `audit_findings` e o painel já existem.
- As extrações existentes validam que o trecho aparece no texto integral, mas não preservam página. `extractPdfTextFull` concatena o documento; PDFs sem camada de texto não são lidos. A extração de agente ainda não captura metodologia, tempo, calibração, entrega/uso/eficácia de EPI ou plano de ação de forma abrangente.
- O cadastro da empresa tem razão social/CNPJ/endereço, mas CNAE e grau de risco não são campos estruturados no tenant. O documento guarda `expires_at`, que deve ser distinguido de validade declarada no texto.
- A base normativa mantém fontes oficiais ativas e documentos com status `vigente`, aprovação humana e relação de substituição; não há intervalo de vigência estruturado por item de regra.
- O backend já usa `pdfkit` para PDFs. O logo horizontal está em `frontend/public/brand/logo-horizontal.jpg`; o build Docker do backend não inclui atualmente assets do frontend.
- O modelo recebido contém exemplos de conclusões normativas e dados de uma empresa real. Esses exemplos são apenas orientação de formato; não podem virar conteúdo fixo, regra automática ou fixture de produção.

## Arquitetura

### 1. Extração page-aware e fatos SST

Processar cada documento mantendo limite de página e número de página original. O extrator pode receber várias páginas por chamada, identificadas no texto, mas cada fato precisa citar uma página e um trecho que seja validado pelo backend contra o texto daquela página. Trecho que não corresponda à página indicada é rejeitado. Registrar versão do extrator e hash do documento para cache; novo hash/versão invalida fatos antigos.

Fatos canônicos por execução/documento incluem, quando citados: empresa e dados cadastrais; emissor e responsável técnico/registro; data, validade e código declarado; setores; funções/CBO/quantitativos; atividades; riscos/agentes; níveis/unidades/método/tempo de exposição; classificação e limites declarados; controles; EPI/CA, fornecimento/uso/atenuação; exames/periodicidade; ações do PGR/responsável/prazos/status; anexos citados e demais conclusões. Preservar texto original e valor normalizado separadamente.

Representação mínima de cada fato: `fact_type`, sujeito/entidade normalizados e texto original não sensível, valor tipado/unidade quando aplicável, `document_id`, página, trecho-fonte mascarado, `evidence_kind`, hash do documento e versão do extrator. `evidence_kind` distingue `quoted_claim`, `direct_measurement`, `document_metadata`, `tenant_registry`, `inference` e `not_located`. Fato documentado não pode ser substituído por inferência. Caches persistidos têm `tenant_id`, RLS e FORCE RLS.

Antes de chamar o provider externo, aplicar `redactPii` com os nomes cadastrados no tenant e CPF; enviar do PCMSO somente fatos necessários sobre riscos previstos, tipos/periodicidade de exames e vínculo agregado à função, não resultados individuais. Se uma página/bloco tiver resultado clínico individual e não puder ser separado com segurança, não enviá-lo ao provider e marcar a extração correspondente como `not_evaluated`. As citações persistidas/exibidas são verificadas contra a mesma versão minimizada da página, ficam marcadas como mascaradas e são rejeitadas se ainda contiverem CPF, nome de trabalhador ou resultado clínico individual. Contagens são agregadas por setor/função quando extraídas ou calculadas de cadastros autorizados e identificadas pela origem. Não extrair nem imprimir nomes, CPF, diagnósticos ou resultados clínicos individuais no PDF.

### 2. Grafo/crosswalk por auditoria

Montar em memória uma entidade SST canônica da empresa e relações entre documento → empresa → setor → função → agente/medição → controle/EPI → exame → ação. Normalizar nomes sem apagar o valor original. Só unir entidades quando a correspondência for exata ou tiver confirmação explícita; ambiguidade gera “a confirmar”, nunca casamento silencioso. Esta fase não cria histórico permanente de relatórios.

### 3. Regras normativas versionadas

Manter um catálogo determinístico, revisado e versionado no código para as regras efetivamente cobertas. Cada regra identifica fonte/código oficial, item, URL oficial, versão do documento normativo, datas de aplicação, campos/evidências mínimos, predicado testável, tipo do achado e correção/verificação recomendada. A regra só roda se a fonte correspondente estiver ativa e a versão oficial aplicável estiver `vigente`/aprovada; caso contrário, o resultado exige revisão técnica.

O catálogo inicial cobre os cruzamentos do modelo: valores de ruído e metodologia; exposição versus enquadramento previdenciário quando os campos bastarem; cadeia de evidências de neutralização por EPI; periodicidade de exame frente a riscos extraídos; risco relevante versus ação no PGR; coerência cadastral e datas/responsáveis; itens de atualização documental somente quando a versão e vigência forem verificáveis. Jurisprudência é identificada separadamente de norma regulamentar e requer referência oficial aprovada.

Os exemplos NC-01 a NC-05 e IN-01 a IN-15 do modelo não são emitidos automaticamente. Cada um precisa de dados reais, requisito vigente e testes próprios. Se a regra não tiver intervalo de vigência verificado ou a fonte não estiver ativa/aprovada, ela não pode fundamentar uma NC; o relatório registra “revisão normativa necessária” e continua os demais cruzamentos.

### 4. Classificações e cobertura

- **NC:** incompatibilidade demonstrada entre evidência direta e regra aplicável, com cadeia completa.
- **IN:** valores, classificações, datas, funções ou conclusões conflitantes entre documentos; pode ser tecnicamente explicável.
- **EA:** anexo/registro citado ou requerido não localizado no conjunto recebido. Usar “não localizado”, nunca “inexistente”.
- **RC (risco a confirmar):** atividade literalmente descrita sugere risco que não foi avaliado; declarar como possibilidade, nunca como risco existente.
- **AT:** referência desatualizada comprovada contra fonte oficial com vigência verificada.
- **RT:** revisão técnica/clínica/jurídica necessária quando a regra, evidência ou aplicabilidade não é suficiente.

Não encontrado na extração é diferente de ausente no documento. PDF escaneado, página ilegível, arquivo faltante ou extração falha devem aparecer como “não avaliado”/“não capturado” no escopo e não geram conformidade nem NC por si só.

O cabeçalho da auditoria usa estados textuais: `Completa` quando os quatro documentos do escopo foram recebidos e suas páginas puderam ser extraídas; `Parcial` quando faltarem documentos, páginas ou extração; `Não avaliável` quando nenhum cruzamento confiável puder ser feito. `Completa` descreve cobertura documental, não conformidade total.

### 5. Montagem do relatório

O resultado estruturado da tela e o PDF usam o mesmo snapshot de auditoria e o mesmo ID/horário local `America/Sao_Paulo`. Cada achado apresenta confiança `alta`, `média` ou `baixa`, calculada a partir da evidência: NC nunca pode ter baixa confiança; risco potencial inferido é sempre “a confirmar” e baixa confiança. Resumo executivo é montado a partir dos achados estruturados (não por texto livre de IA). Classificação de prioridade deve seguir regra explicável; prazos sugeridos são recomendações Montese, não prazos normativos, salvo quando a própria fonte oficial estabelecer prazo.

#### Seções entregues

1. **Identificação, objetivo e escopo:** razão social/CNPJ/endereço disponíveis; CNAE/grau apenas se citados; emissor/responsável; data da análise; solicitante identificado como tal, sem atribuir responsabilidade técnica; quantidades de setores/funções/empregados; documentos, data, páginas, validade, código/assinatura declarados e estado de extração.
2. **Resumo executivo:** conclusão baseada nas evidências, contagens por categoria, limitações e ponto prioritário. Máximo de cinco linhas para o resumo principal; não afirmar “antes do eSocial”, passivo ou autuação como consequência certa sem base suficiente.
3. **Itens consistentes:** matriz por item e por documento, com estados `Igual`, `Divergente`, `Não se aplica`, `Não informa` ou `Não avaliado`, incluindo cadastro, CNAE/grau, quantitativos, setores, funções/CBO, EPI/CA, riscos/medições, responsáveis e datas.
4. **Não conformidades críticas:** uma ficha por NC confirmada com documentos/páginas/trechos, fato, requisito e fonte oficial/versão, comparação, risco/impacto redigido como exposição potencial, prioridade e ação objetiva. Se nenhum requisito suportar uma NC, não criar uma.
5. **Inconsistências e desatualizações:** tabela numerada com documento, página, problema, evidência e ajuste. Inconsistência quantitativa explicita se método, população, período/unidade não puderam ser comparados.
6. **Evidências ausentes e riscos a confirmar:** anexos citados não recebidos em uma lista; riscos potenciais sustentados por atividade literal em outra. Separar os dois grupos.
7. **Recomendações e prioridades:** ações ligadas aos IDs de NC/IN/EA/RC, documentos/páginas e prioridade. Incluir “enquanto isso” apenas quando houver uma medida segura e sustentada, sem orientação clínica individual.
8. **Ressalvas:** documentos/páginas lidos, falhas de extração, anexos não recebidos, ausência de inspeção local/medições originais e necessidade de responsável habilitado. Declarar que não é laudo técnico assinado, parecer médico ou validação jurídica.

O guia de preenchimento do modelo não é incluído no documento destinado à empresa.

### 6. PDF e identidade visual

PDF A4 com margens estáveis, cabeçalho/rodapé em todas as páginas, nome do relatório e empresa no cabeçalho, página atual no rodapé, logo horizontal oficial, títulos azul-marinho, tabelas compactas com cabeçalho escuro/linhas alternadas e ações prioritárias destacadas. Usar Poppins nos títulos e Inter no corpo, conforme o modelo; incluir os arquivos de fonte licenciados no build, sem download de fontes em runtime. Usar o arranjo visual do PDF de referência e verde Montese como acento discreto. Evitar quebra de ficha/linha entre páginas; repetir cabeçalhos de tabelas e não deixar título órfão.

`Código de validação` só é exibido se um valor literal verificável estiver presente no laudo. Caso contrário: “não localizado na extração”. O ID da auditoria é um identificador de rastreabilidade diferente. Assinatura visual encontrada não é validação criptográfica. Nome do cliente do exemplo nunca aparece como conteúdo padrão.

### 7. Interação e entrega

O clique em **Executar Auditoria Montese** continua manual, atualiza a tela e prepara o PDF uma vez. Após sucesso, **Baixar PDF** salva o PDF do mesmo resultado, sem nova análise. Não persistir PDF nem histórico em Postgres/R2. Para manter saída do backend autoritativa e dispensar endpoint de download/armazenamento temporário, o contrato do endpoint passa a incluir bytes PDF codificados somente quando a interface solicitar PDF (`include_pdf: true`); clientes antigos continuam recebendo o contrato JSON aditivo existente.

Nome sugerido: `auditoria-montese-<empresa>-<AAAA-MM-DD>.pdf`. Falha de PDF é mostrada como erro de download e não apaga os achados já recebidos. Limite de execução continua valendo uma vez por auditoria.

### 8. Segurança, privacidade e multitenancy

- A empresa analisa somente o tenant do JWT. Técnico/parceiro precisa de vínculo e o tenant-alvo nunca vira contexto de RLS.
- Fatos persistidos têm RLS e FORCE RLS; queries de documentos e facts ficam em `withTenantContext`.
- Não enviar PII/saúde individual desnecessária ao modelo; o relatório agrega empregados por setor/função.
- Resposta PDF só é gerada no contexto autenticado da execução. Não aceitar JSON de relatório arbitrário do cliente como fonte da versão oficial.
- Rate limit, erros, timeouts e mensagens atuais são mantidos ou ajustados conscientemente para maior duração; falha em um documento não vira documento inexistente.
- O relatório não afirma autenticidade de assinatura, 100% de conformidade, segurança total, consequência jurídica certa ou submissão/validação de eSocial/PPP.

## Validação e critérios de aceite

- Testes unitários por regra cobrem resultado positivo/negativo, não aplicável, dado insuficiente, unidade divergente, período/versão da norma e trecho/página não correspondente.
- Testes de parser cobrem PDF multipágina, sequência de páginas, PDF escaneado/ilegível e citação validada na mesma página.
- Testes de PDF extraem texto e verificam oito seções, logo incorporado, numeração, layout multipágina, tabelas e ausência dos dados do cliente-exemplo.
- E2E com PDFs sintéticos cobre os quatro documentos, geração JSON+PDF em uma execução, download após revisão, limite e isolamento empresa/técnico vinculado/não vinculado; executado somente contra DB/Redis descartáveis, nunca banco de produção.
- Typecheck, lint, build backend/frontend, smoke no ambiente de homologação e revisão visual em PDF multi-página são gates antes de deploy.

## Não objetivos explícitos

- Arquivar PDF/histórico; o usuário escolheu apenas download.
- Validar assinatura digital, certificado ICP-Brasil ou autenticidade de registro profissional.
- Incluir nome, CPF, diagnóstico ou resultado de exame de empregados.
- Declarar consistência de PPP/S-2240 ou transmissão eSocial sem esses dados integrados/fornecidos.
- OCR de qualquer imagem escaneada nesta fase; páginas sem camada textual são “não avaliadas” até existir solução OCR aprovada.
- Emitir conclusão jurídica/médica, declarar validade legal global de um laudo, ou transformar itens exemplificativos do modelo em regras automáticas sem curadoria oficial.