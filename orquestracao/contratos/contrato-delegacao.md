# Contrato de delegação — Montese SST

Toda tarefa entregue a um agente usa este formato (o `delegar` já impõe o formato de retorno).

## Briefing (quem delega preenche)
```
TASK_ID:      (gerado pelo delegar)
OBJETIVO:     o que precisa ficar pronto, em uma frase
CONTEXTO:     fatos confirmados (arquivos/módulos/tabelas já identificados) — marque VERIFICADO/INFERIDO
ESCOPO INCLUÍDO:
ESCOPO EXCLUÍDO:
ARQUIVOS/MÓDULOS AUTORIZADOS:
DEPENDÊNCIAS:  (o que precisa existir antes)
RISCOS:        (tenant/RLS, dados pessoais, regressão, custo de IA...)
CRITÉRIOS DE ACEITAÇÃO:  (verificáveis)
TESTES EXIGIDOS:         (comandos)
EVIDÊNCIAS DE CONCLUSÃO: (o que o agente deve mostrar)
AUTORIZAÇÕES NECESSÁRIAS: (nenhuma | descreva)
CONDIÇÃO DE BLOQUEIO:    (quando parar e perguntar)
```

## Retorno (o agente responde)
1. EXAMINEI — o que leu/analisou.
2. CONCLUSÃO E EVIDÊNCIAS — o que concluiu e o que sustenta.
3. ALTEREI — o que mudou (se autorizado).
4. TESTES — comando e resultado real.
5. RISCOS — o que sobra.
6. LIMITAÇÕES E DÚVIDAS.
7. PRÓXIMA AÇÃO recomendada.
Última linha: `ARQUIVOS_ALTERADOS: a, b` (ou `nenhum`).

Se faltar objetivo, escopo, critério ou autorização: o agente responde `BLOQUEADO:` e lista o que falta, sem agir.

## Regra de independência
Quem implementa não aprova. `revisar` usa outro modelo e lê o diff real.
Migration, RLS, login/papéis, pagamento, upload, IA e dados pessoais exigem também a revisão `seguranca` e a aprovação do proprietário antes de implementar.
