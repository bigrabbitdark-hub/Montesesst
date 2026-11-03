# Análise de impacto — separação de funções adicional (aprovador × signatário × publicador)

Data: 2026-10-20. Pedido do proprietário (Fase 5A, decisão 1): *"Antes de impor separação adicional entre aprovador, signatário e publicador, verificar o fluxo atual e apresentar os impactos para validação."* **Nada além do que está abaixo foi implementado.**

## 1. Fluxo atual (VERIFICADO no código desta fase)
| Etapa | Ação da matriz | Regra de separação vigente |
|---|---|---|
| Criar rascunho / nova versão / enviar à revisão | `elaborar` | — |
| Devolver à elaboração | `revisar` | **Revisor ≠ elaborador** |
| Aprovar | `aprovar` | **Aprovador ≠ elaborador** (decisão do proprietário, por padrão) |
| Assinar (registro interno) | `assinar` + registro profissional **confirmado** | nenhuma (livre) |
| Publicar | `publicar` | nenhuma (livre) |
- "Elaborador" = criador do rascunho, autor de qualquer versão e quem enviou à revisão.
- Matriz nasce vazia: sem linha = ação bloqueada para todos.

## 2. Contexto operacional
- Existem **2 sócios** hoje (Danilo e Évelyn). Futuros colaboradores só entram quando cadastrados (papel `socio` com permissões; o `montese_staff` do desenho original não existe).
- A competência profissional por tipo de documento **não é presumida**: depende da matriz e de registros profissionais confirmados.

## 3. Cenários possíveis e quantas pessoas distintas exigem
| Cenário | Regras acrescentadas | Pessoas distintas mínimas | Viável com 2 sócios? |
|---|---|---|---|
| **A (atual)** | revisor≠elab., aprovador≠elab. | 2 (X elabora; Y revisa/aprova/assina/publica) | **Sim** |
| **B** | A + aprovador≠signatário | 3 se o signatário não puder ser o elaborador; **2 apenas se o signatário for o elaborador** (X elabora e assina; Y revisa/aprova) | Só com o **elaborador assinando o próprio trabalho** |
| **C** | A + signatário≠publicador | 2 (X elabora e publica; Y revisa, aprova e assina) | Sim, mas o **elaborador publica** o que o outro assinou |
| **D** | A + B + C | **3** (elaborador, aprovador, signatário distinto do aprovador, publicador distinto do signatário: com X elaborador e Y aprovador, o signatário deveria ser X ou terceiro, e o publicador distinto do signatário) | **Não** sem terceira pessoa ou sem o elaborador assinar |

## 4. Impactos e riscos
1. **Bloqueio operacional (deadlock):** com as restrições B/D, e dependendo da matriz, pode não existir caminho viável para um tipo de documento. Exemplo: se **só a Évelyn** estiver habilitada a **assinar** um tipo, e ela também for a única habilitada a **aprovar**, então B torna o documento impublicável; se ela for a **elaboradora**, A já impede que ela aprove.
2. **Efeito sobre a competência técnica:** exigir que o signatário seja diferente do aprovador pode **empurrar a assinatura para quem elaborou** (cenário B) — oposto da intenção de separação.
3. **Assinar o próprio trabalho:** hoje é permitido se a pessoa for habilitada (a assinatura exige matriz + registro confirmado; separação só vale para revisar/aprovar). Impedir isso é uma regra diferente das de B/C/D e **não** foi pedida.
4. **Publicador:** publicar é ato administrativo-documental (cria o registro para o cliente). Exigir publicador≠signatário reduz risco de erro/fraude mas dobra a necessidade de pessoas.
5. **Auditoria:** nos cenários A–D, o evento já registra ator por etapa; a diferença é de **prevenção**, não de rastreabilidade.
6. **Migração de dados:** como não há produção ainda, nenhum rascunho existente é afetado; porém a regra deve ficar **configurável** (constantes em `SEPARACAO_PADRAO`) para ajuste sem migração.

## 5. Recomendações (RECOMENDADO)
1. **Manter o cenário A** como padrão até haver mais profissionais habilitados.
2. **Validar a matriz** no momento de configurá-la: acrescentar à API do admin uma verificação de **viabilidade** por categoria ("existe ao menos um caminho elaborar → revisar → aprovar → assinar → publicar respeitando as regras de separação ativas?") e **alertar** quando não existir. Evita configuração que trava o fluxo.
3. Se o proprietário quiser endurecer, fazê-lo **por tipo de documento** (ex.: laudos de maior risco), e não globalmente, e só depois de haver número suficiente de profissionais habilitados.
4. Definir formalmente quem pode **substituir** um profissional ausente (procedimento do admin), para não criar pressão por contornos.

## 6. Decisão pedida
- Manter A?  · Habilitar B, C ou D (global ou por tipo)?  · Incluir a verificação de viabilidade da matriz (recomendada)?
