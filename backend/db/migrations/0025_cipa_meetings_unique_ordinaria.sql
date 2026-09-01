-- Fase 12a (revisão final): CommitteesService.generateMeetings fazia o
-- SELECT do comitê sem FOR UPDATE antes de checar se já existiam
-- reuniões ordinárias — dois cliques rápidos em "gerar reuniões" (ou duas
-- requisições concorrentes) passavam os dois pela checagem de
-- idempotência antes de qualquer um comitar, resultando em 24 reuniões
-- em vez de 12. O FOR UPDATE no service (ver commit desta correção)
-- resolve a corrida em si; este índice único parcial é o backstop de
-- banco — mesmo padrão de "todo invariante real também vira constraint
-- de banco quando possível" já usado no projeto. Parcial porque só
-- reuniões ordinárias têm `numero` não nulo (extraordinárias sempre têm
-- numero NULL, então um índice não-parcial permitiria infinitas
-- extraordinárias com numero NULL colidindo — NULL nunca é igual a NULL
-- em índice único do Postgres, mas o WHERE deixa a intenção explícita).
CREATE UNIQUE INDEX cipa_meetings_ordinaria_numero_unique
  ON cipa_meetings (committee_id, numero)
  WHERE tipo = 'ordinaria';
