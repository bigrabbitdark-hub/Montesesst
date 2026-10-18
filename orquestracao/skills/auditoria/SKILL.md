---
name: auditoria
description: Analisa uma área, um módulo ou uma preocupação do Montese SST sem modificar nada. Aciona os especialistas de leitura certos (segurança, banco, normas, documentos, RAG, eSocial, performance), consolida os achados com evidência e mostra o que depende de profissional habilitado.
argument-hint: "[o que auditar, ex.: isolamento entre empresas no módulo de documentos]"
disable-model-invocation: true
---

# Auditoria (somente leitura)

**O que auditar:** $ARGUMENTS

Se vazio, pergunte em uma frase o que auditar e pare. **Você não edita arquivos, não roda migrations, nem scripts que gravem dados ou chamem IA com custo.** Siga o `AGENTS.md`. Português simples.

## Passo a passo
1. **Delimitar** o escopo (módulos/arquivos/documentos) e o que está fora.
2. **Escolher especialistas de leitura** conforme o assunto:
   - Tenant, RLS, login, papéis, LGPD, segredos → `seguranca`
   - Schema, índices, integridade → `banco-rls`
   - Normas, vigência, fontes oficiais → `normas`
   - PGR/LIP/LTCAT/PCMSO, lacunas → `risco-ocupacional`
   - Documentos e Pente-Fino → `auditor-documentos`
   - Qualidade do Assistente/RAG → `rag-qualidade` (só avaliações locais, sem custo)
   - eSocial → `esocial` · Lentidão → `performance` · Servidor → `infra-release` (só leitura)
3. **Delegar com o contrato**, um por especialista, sempre com `ARQUIVOS_ALTERADOS: nenhum`:
   ```bash
   /opt/Montese/orquestracao/delegar <agente> <<'EOF'
   OBJETIVO: auditar ... (somente leitura)
   CONTEXTO: ...   ESCOPO INCLUÍDO: ...   ESCOPO EXCLUÍDO: ...
   CRITÉRIOS DE ACEITAÇÃO: achados com arquivo:linha, cenário de falha, severidade
   TESTES EXIGIDOS: nenhum que grave dados
   AUTORIZAÇÕES NECESSÁRIAS: nenhuma
   ARQUIVOS_ALTERADOS: nenhum
   EOF
   ```

> **FORMATO OBRIGATÓRIO DO COMANDO DE DELEGAÇÃO** (qualquer variação é bloqueada pela permissão): comece o comando **exatamente** por `/opt/Montese/orquestracao/delegar` (caminho **absoluto**), **sem** `timeout`, `cd`, `ls`, `&&`, `;`, `|`, `&` nem redirecionamento antes ou depois. Um comando por chamada. Se a delegação for demorar, use o **parâmetro de tempo limite da própria ferramenta Bash** (até 600000 ms), nunca o `timeout` do shell. Para delegar em paralelo, faça **várias chamadas da ferramenta na mesma resposta**.

4. **Confrontar** os relatórios: se dois especialistas divergem, aponte e explique; não escolha em silêncio.
5. **Consolidar** em português simples.

## Formato da resposta
- **Resumo em 3 linhas** e **veredito geral** (sem problemas relevantes / com ressalvas / com problemas sérios).
- **Achados por gravidade** (crítico, alto, médio, baixo): o que é, onde (`arquivo:linha`), por que importa, **evidência**, correção sugerida.
- **Fatos documentados × hipóteses** (rotule VERIFICADO / INFERIDO / NÃO VERIFICADO) e as **fontes** consultadas.
- **O que exige profissional habilitado** (SST/jurídico/contábil), sem fingir que a IA decide.
- **O que não foi examinado** e por quê.
- **Próximos passos** recomendados, sem executá-los. Lembre que **nada foi alterado**.
