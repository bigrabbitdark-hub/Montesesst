# Painel da Evelyn — E5: LTCAT e laudos como etapas ligadas ao PGR (desenho)

**Data:** 2026-11-02 · **Estado:** desenho para aprovação; **nenhum código, nenhuma migration**.
**Origem (respostas da engenheira):** documentos separados por etapa; "LTCAT segue o PGR"; laudos (insalubridade/periculosidade) com checklist próprio; querer ver, para cada empresa, em que etapa está cada documento técnico.

## 1. O que já existe (VERIFICADO por leitura de 0096)
- `document_drafts.category` já aceita `pgr`, `ltcat`, `lip`, `laudo`, `pcmso`, `relatorio_visita`: cada um é um rascunho independente, com o mesmo fluxo (elaboração → revisão → aprovado → assinado → publicado), versões, correções (0102) e checklist (0103).
- **Não existe vínculo entre rascunhos** (LTCAT não sabe de qual PGR deriva) nem visão consolidada por empresa/unidade.
- Validade vem de `document_validity_rules` (0079/0104); "segue o PGR" ainda é só uma convenção verbal.

## 2. Proposta (aditiva, nasce vazia)
**a) Vínculo** — coluna opcional `document_drafts.base_draft_id` (FK para outro rascunho da MESMA empresa) com CHECK por função IMMUTABLE/trigger: só `ltcat`, `lip`, `laudo` podem apontar e só para categoria `pgr`. Trigger garante mesmo `tenant_id` (RLS não basta: FK ignora RLS).
**b) Regra "segue o PGR"** — o LTCAT/laudo NÃO herda data automaticamente: o sistema apenas **avisa** (nunca bloqueia) quando o PGR-base foi publicado depois da versão do LTCAT, ou quando o PGR-base está vencido ou em revisão por mudança (E4). A decisão técnica continua sendo da engenheira (a plataforma não interpreta norma).
**c) Visão por empresa** — endpoint `GET /atuacao/empresas/:id/documentos-tecnicos` devolvendo, por categoria, o rascunho mais recente, sua etapa, correções pendentes, checklist e vínculo; tela `/atuacao/empresas/[id]/documentos` com linha do tempo simples. Sem IA.
**d) Alerta** — nova fonte no job E4: "PGR-base atualizado, revisar LTCAT/laudo" (mesma notificação genérica: tipo + empresa).

## 3. Riscos e limites
- FK cruzada entre tenants (mitigar com trigger + teste RLS).
- Falso conforto: o aviso é auxiliar; prazo legal e conteúdo seguem a responsabilidade do profissional habilitado.
- PGR 2 anos / LTCAT segue PGR continuam **NÃO VERIFICADOS** contra fonte oficial; nada é gravado como norma.

## 4. Decisões necessárias
1. O vínculo deve ser obrigatório para LTCAT ou opcional (recomendado: opcional)?
2. Laudos (insalubridade/periculosidade) também ligam ao PGR, ou só ao LTCAT?
3. O aviso "PGR mais novo que o LTCAT" deve gerar notificação (recomendado) ou só selo na tela?

## 5. Fatiamento
- **E5a** migration 0105 (coluna + trigger + índice) + testes RLS/tenant. Revisão `montese-seguranca`.
- **E5b** serviço/endpoint de vínculo e visão por empresa + testes.
- **E5c** tela e fonte de alerta no job.
- Risco: MÉDIO (FK entre rascunhos, RLS). Numeração: 0105 depende da ordem de release 0101→0104.
