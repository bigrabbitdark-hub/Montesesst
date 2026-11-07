# Integração: "sócia atua como empresa" (0108) × técnico assinante (0109/0110)

Data: 2026-11-07 · Rótulos: VERIFICADO = lido/aplicado; NÃO VERIFICADO = não executado.

## Situação
- `0108_socio_cadastra_atua_empresa.sql` está **aplicada em produção** (2026-11-07) e registrada em `_migrations`.
- A linhagem do técnico assinante (árvore `/opt/Montese`, não commitada) já foi **renumerada** por outra sessão para `0109_tecnico_assinante_isolamento.sql` e `0110_tecnico_assinante_ativacao_e_empresa.sql` (VERIFICADO por `ls`). Não há mais colisão de número. A numeração final segue sendo do proprietário no merge.
- A 0109 do técnico cria `tenants.owner_technician_id`. Empresas de assinante são `tenants` ativos, SEM linha em `tenant_technicians`/`tenant_partners`. VERIFICADO: a `socio_can_act_on_tenant` atual só checa a ausência dessas duas linhas (0108, linhas 116-127).

## Risco (VERIFICADO no SQL, NÃO exercitado)
Se a 0109/0110 entrar sem o guarda abaixo, a sócia passa a poder emitir token de atuação em empresa de assinante (dado de cliente do técnico, fora do perímetro definido pelo dono).

## Migration de guarda (RASCUNHO — NÃO colocar em `db/migrations` antes da 0109 existir; a coluna não existe em produção)
Nome sugerido: `0111_socio_atua_exclui_assinante.sql` (depois da 0110). Só roda onde `tenants.owner_technician_id` existe.

```sql
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION socio_can_act_on_tenant(p_socio_id UUID, p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
         current_setting('app.role', true) = 'socio'
     AND p_socio_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     AND EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.atuar')
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND t.status = 'ativo'
                                           AND t.owner_technician_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM tenant_technicians tt WHERE tt.tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners tp WHERE tp.tenant_id = p_tenant_id)
  ), false);
$$;
-- CREATE OR REPLACE preserva dono e ACL (montese_auth_bypass; EXECUTE só montese_app); conferir com \df+ depois.
```
Rollback: reaplicar o corpo da 0108 (linhas 116-127).

## Teste obrigatório (a escrever junto com a migration)
No e2e `socio-atua-empresa`: criar empresa de assinante (`owner_technician_id` preenchido) → `POST /atuacao/clientes/:id/atuar` deve dar 403 e `atuacao.negada`; empresa Montese normal continua 200. Sabotar (remover a linha do guarda) e provar que o teste fica vermelho.

## Ordem de release combinada (proposta, RECOMENDADO)
1. (feito) 0108 sócia. 2. 0109 e 0110 do técnico. 3. 0111 guarda — **na mesma janela da 0109**, nunca depois (entre uma e outra a sócia atuaria em assinante). 4. Backends/frontends correspondentes.
Também resolver o conflito de código com `/opt/montese-sessao` (`jwt.strategy`, `auth.service`) no merge.

## Atualização 2026-11-07 — migration e teste prontos (VERIFICADO no ensaio descartável)
- `backend/db/pendentes-tecnico/0111_socio_atua_exclui_assinante.sql` (FORA de `db/migrations` de propósito; mover para lá só junto da 0109) e `teste_0111_socio_nao_atua_em_assinante.sql`.
- Ensaio: cópia do banco de ensaio com 0108 + 0109 + 0110 do técnico (da árvore `/opt/Montese`). Com a 0111: Montese normal = permitida; empresa de assinante (`kind='tecnico_proprio'`, dono com `account_type='assinante'`) = negada. **Sabotagem** (voltar ao corpo da 0108): a negação do assinante vira `f` (teste fica vermelho); restaurando a 0111, volta a verde. Dono `montese_auth_bypass`, SECURITY DEFINER, EXECUTE só `montese_app` (não PUBLIC) conferidos após a troca.
- Lição do teste: tenants nascem `pendente`; sem `status='ativo'` a "permitida" dava falso e o teste não provava nada (corrigido).
- NÃO VERIFICADO: o e2e HTTP (`POST /atuacao/clientes/:id/atuar` → 403 em assinante), pois depende do código do técnico assinante, ainda não commitado/mesclado.
