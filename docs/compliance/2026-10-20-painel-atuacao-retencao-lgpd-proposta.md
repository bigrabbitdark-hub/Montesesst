# Proposta de retenção — dados do Painel de Atuação (Fase 5A) — PARA VALIDAÇÃO

Data: 2026-10-20 · Status: **PROPOSTA, não implementada, nenhuma exclusão irreversível autorizada.** Pedido do proprietário (Fase 5A, decisão 3).

> **Aviso sobre fontes.** Os prazos abaixo são **propostas de gestão (RECOMENDADO)**, não prazos legais. Obrigações específicas de guarda de documentos de SST (por exemplo, por tipo de documento) **não foram levantadas aqui** e devem ser confirmadas em fonte oficial (pelo agente `montese-normas`, com validação do encarregado/jurídico) antes de qualquer prazo ser adotado. A LGPD (Lei 13.709/2018) trata de término do tratamento e eliminação nos arts. 15 e 16; a leitura exata dos hipóteses de conservação e a base legal aplicável devem ser confirmadas pelo encarregado (DPO) com a fonte oficial — este texto não é parecer jurídico.

## 1. Dados em questão
| Dado | Onde fica | Natureza | Observações |
|---|---|---|---|
| **Notas / justificativas** (versão, devolução, cancelamento, eventos) | `document_draft_versions.note`, `document_draft_events.note` | Texto livre; pode conter dado pessoal de terceiros | Não deveria conter dado sensível; hoje não há bloqueio |
| **IP** do signatário | `document_draft_signatures.ip`; `audit_log.ip_address` | Dado pessoal (identificador de rede) | Evidência de autoria + segurança |
| **User-agent** do signatário | `document_draft_signatures.user_agent` | Dado técnico que pode identificar dispositivo | Evidência complementar |
| Hash da versão, data/hora, signatário, snapshot do registro profissional | `document_draft_signatures` | Dado pessoal do profissional (nome, conselho, número) | Núcleo da trilha; ver §5 sobre visibilidade |
| Agenda/tarefas/interações (texto livre) | Fases 3A/3B | Texto livre | **Fora desta proposta** — mesma política deve ser aplicada depois por analogia |

## 2. Finalidade e necessidade (proposta)
- **Notas:** registrar o motivo de devoluções, cancelamentos e alterações para rastreabilidade do documento. Necessárias enquanto o documento e seu histórico existirem.
- **IP e user-agent:** reforço de evidência de **quem** executou o registro de assinatura interna e investigação de uso indevido da conta. Necessidade decrescente com o tempo; o essencial da prova é o par signatário + versão + hash + data/hora.
- Minimização: **não coletar** nada além disso; não usar para outras finalidades (marketing, monitoramento de produtividade).

## 3. Prazos propostos (a validar)
| Dado | Opção A (conservadora) — RECOMENDADO | Opção B (probatória estendida) |
|---|---|---|
| IP + user-agent completos | **12 meses** após a assinatura; depois **anonimização parcial**: IP truncado (IPv4 /24, IPv6 /48) e user-agent removido | 36 meses completos; depois anonimização parcial |
| Notas de versão/evento | Enquanto existir o registro de fluxo do documento; **revisão anual** por amostragem para dado indevido | Idem |
| Registro de assinatura (signatário, hash, data/hora, snapshot do registro) | Vida útil do documento publicado **+ prazo normativo do tipo de documento (a levantar em fonte oficial)** | Idem |
| `audit_log` (IP de requisição) | Política geral do sistema (não definida hoje) — tratar à parte | Idem |

Decisão pedida ao proprietário/encarregado: **A ou B**, e quem é o encarregado responsável pela aprovação do descarte.

## 4. Acesso
- Notas: sócios com `documents.read` na carteira (já vigente) e admin (leitura).
- IP e user-agent: **não são devolvidos pela API hoje**; ficam só no banco. Proposta: acesso por pedido do encarregado/admin, com registro em auditoria, para apuração de incidente.
- Conselho/número do signatário: restritos a quem tem `documents.view_registration` (decisão 4) e ao admin.

## 5. Procedimento de descarte (proposta; **não executar antes da aprovação**)
1. Rotina **somente de relatório** (dry-run) lista, por tabela, quantos registros passaram do prazo — sem alterar dados.
2. O encarregado revisa o relatório e **aprova por escrito** o lote.
3. Execução por função controlada, com **auditoria** (`retention.applied`: tabela, contagem, critério, responsável; sem conteúdo) e backup prévio do banco.
4. Verificação posterior (contagens, integridade do hash e da trilha) e relato ao proprietário.
- **Nunca** apagar a linha de assinatura nem o evento (a trilha deve continuar); a medida é **anonimizar campos** (IP/user-agent) e, se aprovado, **substituir o texto de notas** por um marcador ("removido por política de retenção") preservando autor, data e tipo do evento.

## 6. Impacto técnico a decidir antes de implementar
- As tabelas `document_draft_versions`, `document_draft_events` e `document_draft_signatures` são **append-only por trigger** (UPDATE e DELETE direto falham até para o superusuário). A anonimização exige um **mecanismo controlado e auditado**:
  - **Recomendado:** mover IP/user-agent para uma tabela própria de evidência técnica (`document_draft_signature_evidence`) com política de anonimização explícita, mantendo a assinatura imutável; **ou**
  - função dedicada (`retention_anonymize_signature_evidence`) com dono privilegiado, que desabilita a guarda apenas para colunas específicas e registra auditoria.
- `ON DELETE CASCADE` de tenant/rascunho já remove o histórico quando o cliente é excluído; a política deve prever o que acontece com documentos publicados e com pedidos de eliminação do titular (ex.: profissional que deixa a empresa).
- `created_by`/`owner_user_id` sem `ON DELETE` impedem eliminar usuário sócio; definir pseudonimização do usuário em vez de exclusão.
- Textos livres devem ganhar **aviso na interface** ("não inclua dados pessoais sensíveis ou de saúde") e limite de tamanho (já há).

## 7. Pendências para aprovação
1. Opção A ou B (§3) e nomeação do encarregado.
2. Levantamento oficial dos prazos de guarda por tipo de documento (PGR, PCMSO, LTCAT, laudos, treinamentos…).
3. Escolha do mecanismo técnico de anonimização (§6).
4. Decisão sobre aplicar a mesma política às Fases 3A/3B (tarefas, agenda, interações).

**Nenhuma exclusão ou anonimização será implementada até a aprovação desta política.**
