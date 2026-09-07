# Fase 22 — Funcionários: importação de planilha com mapeamento flexível

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-07.
> Segunda fatia real da visão de "Diagnóstico Inicial" (a primeira foi
> a Fase 21, upload de documentos em lote) — ver
> `docs/assistente-montese-principios.md` pros princípios herdados
> (assistir não substituir, "isso precisa mesmo de LLM, ou é nível
> 1?" antes de qualquer capacidade nova).

## 1. Objetivo e escopo

Hoje a importação de funcionários (`POST /employees/import`, endpoint
já existente) só aceita um `.csv` com cabeçalho EXATO
(`nome,cpf,cargo,filial`, nessa ordem) — qualquer planilha exportada
de um sistema de RH real (com colunas tipo "Nome Completo",
"Documento", "Função", "Unidade", em qualquer ordem) é rejeitada de
cara com erro de formato.

Esta fase permite subir **CSV ou XLSX real**, com **qualquer
nome/ordem de coluna** — um dicionário de sinônimos determinístico
(sem IA) sugere qual coluna é nome/cpf/cargo/filial, a empresa revisa
e confirma o mapeamento antes de importar. O fluxo novo **substitui**
o botão de upload atual na tela de Funcionários (não convivem lado a
lado) — decisão do fundador, já que o fluxo novo cobre o caso antigo
também (um CSV com cabeçalho exato bate no dicionário de sinônimos
sem esforço extra do usuário).

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **CSV + XLSX real** (não só CSV) — o fundador escolheu o escopo
  maior deliberadamente, mesmo sabendo que isso exige uma biblioteca
  nova de parsing (nenhuma existe no projeto hoje).
- **Mapeamento de coluna 100% determinístico, sem IA** — um
  dicionário de sinônimos conhecidos resolve o mapeamento sem gastar
  nenhuma chamada de IA. Segue a disciplina já registrada no projeto
  (nível 1 antes de nível 3). Se o dicionário errar ou não reconhecer
  uma coluna, a empresa corrige manualmente na tela de revisão — não
  é um problema silencioso, é sempre corrigível na hora.
- **Reaproveita a lógica de validação/inserção já existente** — CPF
  precisa ter 11 dígitos, filial precisa bater o nome exato de uma
  `company_units` já cadastrada, savepoint por linha (erro numa linha
  não aborta as demais), CPF duplicado vira erro por linha, não
  exceção que derruba a importação inteira. Nada disso muda; só a
  etapa "extrair as 4 colunas do arquivo bruto" ganha uma
  implementação nova, em paralelo à atual (`parseEmployeesCsv`, que
  fica intocada).
- **Fluxo em 2 passos** (preview/mapeamento → confirmação), mesma
  disciplina já usada na Fase 21 (upload de documentos em lote):
  nada é salvo no primeiro passo, só depois da confirmação explícita
  do usuário.
- **`exceljs`** como biblioteca de parsing de XLSX (MIT, ativamente
  mantida, sem a controvérsia de distribuição que o pacote `xlsx`
  (SheetJS) já teve).
- **Endpoint antigo (`POST /employees/import`) não é apagado do
  backend** — só deixa de ser usado pela UI. Continua existindo (não
  há motivo pra remover código de backend já testado só porque a UI
  parou de chamá-lo).

## 3. Modelo de dados

Nenhuma tabela nova. `employees`/`company_units` não mudam.

## 4. Fluxo

1. Empresa seleciona um arquivo (`.csv` ou `.xlsx`) na tela de
   Funcionários (`FuncionariosForm.tsx`, substituindo o upload atual).
2. Frontend envia `POST /employees/import-preview` (novo, multipart,
   campo `file`, limite de 10MB e 2000 linhas — mesmo `MAX_IMPORT_ROWS`
   já usado hoje).
3. Backend detecta o tipo (mimetype/extensão), extrai os cabeçalhos
   da primeira linha (CSV) ou primeira linha da primeira planilha
   (XLSX), aplica o dicionário de sinônimos, e devolve:
   `{ headers: string[], suggested_mapping: { nome: number | null,
   cpf: number | null, cargo: number | null, filial: number | null },
   sample_rows: string[][], total_rows: number }` — o mapeamento é por
   **ÍNDICE da coluna** (posição no array `headers`), nunca por nome,
   pra nunca ficar ambíguo se a planilha tiver dois cabeçalhos iguais
   (ex: duas colunas "Nome"). `sample_rows` são as 5 primeiras linhas
   de dado (não o arquivo inteiro), só pra confirmação visual. Nada é
   salvo.
4. Frontend mostra uma tela de mapeamento: 4 dropdowns (um por campo
   obrigatório: nome, cpf, cargo, filial), cada um pré-selecionado
   com o índice sugerido pelo dicionário (ou vazio se não
   reconhecido), listando os cabeçalhos reais do arquivo como opções
   (o `value` de cada opção é o índice, o texto exibido é o nome da
   coluna). Uma pequena tabela de amostra (as `sample_rows`) ajuda a
   conferir visualmente.
5. Empresa confirma (ou ajusta) o mapeamento e clica em "Importar".
   Frontend reenvia o MESMO arquivo (mantido em memória desde o passo
   1) + o mapeamento confirmado (os 4 índices de coluna escolhidos)
   pra `POST /employees/import-mapped` (novo).
6. Backend reparseia o arquivo (mesma lógica do passo 3, mesmo
   parser), usa o mapeamento confirmado pra extrair `full_name`/
   `cpf`/`position`/`company_unit_name` de cada linha, e passa pra
   EXATAMENTE a mesma lógica de validação/inserção linha-a-linha que
   `EmployeesService.importCsv` já tem hoje (extraída pra um método
   privado compartilhado entre os dois caminhos). Resposta idêntica
   ao formato já existente: `{ importados: number, erros:
   { linha: number, motivo: string }[] }`.

## 5. Dicionário de sinônimos (determinístico)

Cada campo reconhece o cabeçalho exato já usado hoje MAIS variações
comuns (comparação case-insensitive, sem acentos, espaços colapsados):

- **nome**: `nome`, `nome completo`, `funcionario`, `funcionário`,
  `colaborador`, `nome do funcionario`
- **cpf**: `cpf`, `documento`, `cpf/mf`, `numero do cpf`, `n do cpf`
- **cargo**: `cargo`, `funcao`, `função`, `cargo/funcao`, `posicao`,
  `posição`
- **filial**: `filial`, `unidade`, `local`, `unidade/filial`,
  `setor` (nota: "setor" aparece aqui como sinônimo aproximado de
  filial nesta lista de reconhecimento — pode ser ambíguo com um
  futuro campo "setor" de funcionário, que não existe hoje; se um dia
  existir, revisitar essa entrada)

Se nenhum cabeçalho do arquivo bater com um campo, `suggested_mapping`
devolve `null` pra esse campo — a empresa escolhe manualmente na tela
de revisão, sem bloquear o restante do mapeamento.

## 6. Fora de escopo

- Qualquer mudança na validação de CPF/filial já existente (continua
  exigindo exatamente 11 dígitos e nome de filial já cadastrado).
- Remoção do endpoint antigo `POST /employees/import` do backend.
- Mapeamento de campos além dos 4 já existentes (não adiciona setor,
  data de admissão, e-mail, etc. — isso é ampliação de modelo de
  dados, fora do escopo desta fase).
- Qualquer uso de IA/MiniMax nesta fase — todo o mapeamento é
  determinístico.
- Qualquer mudança no upload de documentos em lote (Fase 21) ou em
  qualquer outra tela.
