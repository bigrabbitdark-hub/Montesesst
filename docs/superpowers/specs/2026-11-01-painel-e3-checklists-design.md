# Painel da Evelyn — E3: checklists por serviço com aprovação técnica (desenho)

**Data:** 2026-11-01 · **Estado:** desenho para aprovação; **nenhum código, nenhuma migration**.
**Origem:** respostas da engenheira sócia: "a plataforma deve ter um checklist diferente para cada serviço"; "quero validar tecnicamente os modelos de checklist antes da utilização"; "identificar campos obrigatórios não preenchidos, inconsistências e ausência de informações necessárias"; "o levantamento deve seguir um checklist padronizado".

## 1. O que já existe (VERIFICADO por leitura)
- `inspection_checklist_items` (0010) e `checklist-items.const.ts`: checklist FIXO de visita do técnico (C/NC/NA), sem versões nem aprovação, e que o sócio não edita.
- `prevention_checklist_items` e `sst-checklist`: outros checklists de módulos distintos. **Não reutilizar nem alterar.**
- Fluxo de documentos (0096) e correções (0102): sem noção de checklist.
- Padrão do projeto para conteúdo técnico: tabela nasce **vazia**, publicada por pessoa habilitada, versões imutáveis (matriz de risco B1, 0099).

## 2. Proposta
**Modelo (global, versionado, imutável depois de aprovado):**
- `checklist_templates` (id, `service` = pgr|ltcat|laudo_insalubridade|laudo_periculosidade|visita_tecnica|outro, nome, criado_por) e `checklist_template_versions` (template_id, número, status `rascunho|aprovado|substituido`, aprovado_por/aprovado_em, nota de mudança). Só `aprovado` pode ser usado. Aprovar exige permissão nova `checklists.approve` (concedida só à engenheira, pela tela de permissões existente) e registro auditado.
- `checklist_template_items` (versão, ordem, rótulo, instrução, tipo `sim_nao_na|texto|numero|data|anexo`, `obrigatorio`, `bloqueia_envio_revisao`).
- Conteúdo dos itens: **fornecido e aprovado pela engenheira**. O sistema não traz itens prontos nem cita norma por conta própria (regra do projeto: nunca inventar norma/artigo/prazo).

**Uso (por documento):**
- `document_checklists` (draft_id, versão do modelo, unidade da empresa opcional) e `document_checklist_answers` (item, resposta, nota, quem/quando). Instância ligada ao rascunho do fluxo documental, na mesma empresa, com RLS da carteira.
- **Completude:** endpoint calcula obrigatórios sem resposta e marca "faltando informação". `enviar-revisao` fica bloqueado (409 com a lista) enquanto houver item obrigatório com `bloqueia_envio_revisao` sem resposta — mesmo padrão do bloqueio por correções pendentes.
- Item respondido "não conforme/lacuna" pode gerar uma **correção** (0102) com um clique.

**Telas:** `/admin`-like `/atuacao/checklists` (modelos: criar rascunho, editar itens, aprovar — só quem tem `checklists.approve`); aba "Checklist" no detalhe do documento (preencher, ver pendências).

## 3. Fora desta fatia
- Substituir o checklist de visita do técnico (`inspection_checklist_items`): decisão futura, depende de D3b.
- IA preenchendo checklist (minimização de dados/LGPD; fica desligada).
- Alertas de vencimento (E4), etapas LTCAT/laudos (E5).

## 4. Decisões necessárias do proprietário/engenheira
1. Lista de **serviços** que terão modelo (PGR, LTCAT, laudo de insalubridade, laudo de periculosidade, relatório de inspeção, APR, ordem de serviço…?).
2. Os **itens** de cada modelo: a Evelyn cadastra pela tela depois que ela existir (recomendado), ou envia o texto para carga inicial revisada por ela.
3. Aprovação do modelo: só a Evelyn (`checklists.approve`), correto? Aprovar modelo próprio é aceitável (a separação de funções está desligada)?
4. O bloqueio de envio à revisão por item obrigatório pendente é desejado, ou apenas aviso?
5. Retenção: respostas ficam para sempre com o documento (recomendado, rastreabilidade).

## 5. Fatiamento (cada uma com testes, RLS e revisão independente)
- **E3a** migration (modelos, versões, itens, instâncias, respostas) + RLS + permissão `checklists.approve` (CHECK de `socio_permissions`, `PERMISSIONS`, catálogo e testes que fixam 18→19).
- **E3b** API de modelos (CRUD de rascunho, aprovar) e API de instância/resposta/completude.
- **E3c** bloqueio no `enviar-revisao` + "gerar correção" a partir de item.
- **E3d** telas.
- Risco: ALTO moderado (nova permissão e RLS); revisão `montese-seguranca` obrigatória.
