# Processo interno de resposta a incidentes de segurança

> Documento interno (não publicado no site) — a
> [Política de Incidentes de Segurança](../../frontend/content/legal/incidentes.mdx)
> pública referencia este processo sem revelar detalhe técnico
> explorável. Mesma postura do resto de `docs/compliance/`: escrito sem
> advogado envolvido, pontos ⚠️ precisam de validação jurídica antes de
> virar compromisso público com prazo específico.

## 1. Quem responde

Hoje, o fundador acumula o papel de responsável técnico e de
Encarregado (DPO) — não há equipe de segurança dedicada. Isso é
aceitável para o estágio atual (`lgpd-compliance.md` §2), mas significa
que **não há SLA formal de resposta** ainda — qualquer prazo público
precisa refletir isso honestamente.

## 2. Detecção

- **Reativa hoje**: logs estruturados por requisição
  (`docs/operations/reliability.md` §2) e a trilha `audit_log`
  (consultável desde 2026-08-26 em `/admin/auditoria`) são a fonte de
  investigação quando algo é reportado ou percebido.
- **Não existe alerta automático de anomalia** — pendência já registrada
  em `reliability.md` §4 ("Alertar sobre rate limit / erros 5xx em tempo
  real"). Um incidente sutil pode não ser percebido até virar sintoma
  visível (erro reportado por cliente, comportamento anômalo notado
  manualmente).

## 3. Triagem

Ao ser identificado um possível incidente (acesso indevido, vazamento,
comprometimento de credencial, indisponibilidade anormal), avaliar:

- Que dado foi potencialmente exposto? (dado de conta vs. dado de
  funcionário/saúde — ver classificação em `lgpd-compliance.md` §3)
- Quantos tenants/empresas são afetados?
- O acesso indevido já cessou, ou ainda está em curso?

## 4. Contenção

Ações técnicas já disponíveis hoje, sem trabalho novo:

- Revogar/trocar credencial comprometida (rotação de `JWT_SECRET`
  invalida todas as sessões ativas de uma vez, se necessário).
- Desativar conta específica (`status = 'inativo'` em `users`).
- Restaurar de backup em caso de corrupção/exclusão maliciosa —
  processo testado de ponta a ponta (`docs/operations/backups.md`).

## 5. Comunicação

⚠️ **Pendência de validação jurídica.** A LGPD (Art. 48) exige
comunicar a ANPD e os titulares afetados em caso de incidente que
possa acarretar risco ou dano relevante, "em prazo razoável" — o
prazo exato e o critério de "risco relevante" aplicável não estão
confirmados aqui. Até essa validação, o compromisso público (ver
política pública) deve evitar prometer um número de dias específico.

Se o incidente envolver dado de funcionário de empresa cliente, a
empresa cliente (controladora, `lgpd-compliance.md` §2) precisa ser
informada — o Montese, como operador, não decide sozinho como
comunicar aos titulares finais.

## 6. Registro

Cada incidente real (mesmo pequeno) deve ser documentado — o que
aconteceu, quando foi detectado, ação tomada, resultado. Ainda não
existe um registro formal/planilha para isso; primeiro incidente real
vira o gatilho para criar esse registro, não antes.

## 7. Pós-incidente

Revisar o que falhou tecnicamente ou no processo, e registrar a ação
corretiva. Sem incidente real registrado ainda em 2026-08-26 — esta
seção é o compromisso de processo, não um histórico.
