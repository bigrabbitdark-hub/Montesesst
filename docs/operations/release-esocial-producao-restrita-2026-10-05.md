# Release eSocial S-2220 em Produção Restrita (2026-10-05)

Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
Worktree: `/opt/montese-esocial`, branch `feat/esocial-transmissao` (base `0969bb7`). **Sem commit e sem push** (AGENTS.md). Imagens candidatas: `montese-backend:candidate-esocial-20261005`, `montese-frontend:candidate-esocial-20261005`. Nada foi aplicado em produção.

## O que foi entregue
XML S-2220 → validação no XSD oficial → autorização humana → assinatura A1 → lote → SOAP/mTLS → consulta → recibo, em módulo NestJS isolado (`backend/src/esocial`), só em **Produção Restrita** (produção real fica bloqueada no serviço e `NULL` no banco). Tela: `/empresa/esocial`. Sem cron: assinar, transmitir e consultar só acontecem por clique de um usuário, que fica no histórico (G-03).

## Verificado (ensaio descartável, sem credencial de produção)
- 22 e2e em 7 suítes (fluxo completo, RLS de eventos, certificados, ASO, `tenant-isolation-sweep`); 604/605 unitários (a falha é `r2-get-object`, que já falhava sem bucket); `tsc` limpo; frontend 134 testes e `tsc` limpos.
- XML do evento assinado passa no XSD oficial **com** `Signature`; adulterar um campo invalida a assinatura; lote e consulta passam nos XSD oficiais do Pacote de Comunicação v1.6.
- Cliente SOAP: apresenta certificado de cliente, recusa hostname errado, CA desconhecida e domínio fora de `esocial.gov.br` (testado com servidor local).
- Handshake real com o servidor de Produção Restrita, sem certificado e sem dados: TLS 1.2, cifra oficial, cadeia e hostname válidos, HTTP 403 (esperado sem certificado).
- Imagem Alpine: XSD valida e a aplicação sobe em modo produção (`/health` 200; rotas novas respondem 401 sem token).

## NÃO verificado (só dá para saber no teste real)
- **Nenhum envio real ao eSocial foi feito.** O aceite do servidor, a regra semântica do eSocial e os códigos de retorno reais ainda não foram vistos; os parsers usam respostas montadas a partir dos XSD oficiais.
- Se o eSocial aceita o certificado do cliente como transmissor e assinante do evento do cliente (INFERIDO, manual não exige procuração para o envio).
- Códigos da Tabela 27 (exames): quem cadastra é o médico/SST; o sistema não adivinha.
- Matrícula/categoria obrigatórias para o vínculo: hoje são só aviso; o servidor decide.

## Passos do proprietário (ordem; nada disto foi feito por mim)
1. **Chave mestra:** `openssl rand -hex 32` e guarde (perdê-la torna os certificados irrecuperáveis). Acrescente ao `.env`: `ESOCIAL_CERT_ENCRYPTION_KEY=<valor>`.
2. **docker-compose.yml (infra, sua autorização):** no `environment` do backend, ao lado da linha de `GOOGLE_TOKEN_ENCRYPTION_KEY`, acrescentar `ESOCIAL_CERT_ENCRYPTION_KEY: ${ESOCIAL_CERT_ENCRYPTION_KEY}`. A chave é opcional no boot: sem ela o backend sobe e o eSocial responde 503.
3. **Backup:** `bash ops/backup-postgres.sh`.
4. **Migrations 0065 a 0069** (novas tabelas e colunas; nenhuma altera dados existentes): `docker cp` dos 5 arquivos para `montese_backend:/app/db/migrations/` e `npm run db:migrate`. O runner aplica por nome de arquivo, então a `0063` do PDF (outra branch) não bloqueia.
5. **Backend:** `docker tag montese-backend:candidate-esocial-20261005 montese-backend:latest` e `docker compose up -d --no-deps backend`. **Frontend** idem com a tag do frontend.
6. Rollback: reaponte `latest` para a imagem anterior; as migrations só adicionam objetos novos.

## Roteiro do teste em Produção Restrita (precisa de um A1 ICP-Brasil válido)
1. Em `/empresa/esocial`, envie o certificado A1 (a senha só trafega nesse envio).
2. Escolha funcionário e cadastre o ASO; cadastre o coordenador do PCMSO se houver.
3. Em "Dados do vínculo", informe matrícula e categoria e confirme que o vínculo já está no eSocial (isso exige que o S-2200/S-2190/S-2300 já tenha sido enviado por quem faz a folha, no mesmo ambiente de testes).
4. Adicione ao menos um exame com código da Tabela 27 (inclua a avaliação clínica; código `0281` exige a ordem).
5. "Verificar pendências", "Gerar evento", "Autorizar", "Assinar e transmitir", depois "Consultar resultado" até aparecer o recibo ou a rejeição (com código e mensagem).
6. Guarde o resultado: o eSocial mantém o retorno do lote por 30 dias.

## Pendências conhecidas
- Só S-2220. S-2210, S-2240 e S-3000 dependem de módulo de CAT, inventário de risco e do recibo (próximas fases).
- CNPJ alfanumérico (N8): o diagnóstico só confere o formato; o cadastro de empresa ainda aceita só dígitos.
- A transmissão segura a conexão de banco aberta durante a chamada ao eSocial (até 60 s). Aceitável para teste de baixo volume; para volume, separar em duas etapas.
- Se a conexão cair depois de o eSocial receber o lote, o evento fica `erro_tecnico` e não é reenviado sozinho (evita duplicidade); a pessoa decide criar novo evento.
- Achados da auditoria tratados aqui: E-01 (numeração), E-03 (teste de RLS de eventos recriado), E-04, E-05, E-06, E-07 (FK `RESTRICT`), E-08, E-09, E-13, E-19, G-01, G-02, G-03 e parte de G-04. Abertos: E-10, E-11, E-12 (parcial), E-16, E-17 (LGPD do ASO), retenção do certificado removido.

---

# Adendo: N8, S-3000 e S-2210 (CAT), mesma data, **ainda NÃO aplicado em produção**

Em produção está o primeiro lote (S-2220, migrations 0065–0069, imagens `candidate-esocial-20261005`). Este adendo está só na worktree e em novas imagens candidatas `montese-backend:candidate-esocial2-20261005` e `montese-frontend:candidate-esocial2-20261005`.

## O que entra
- **N8, CNPJ alfanumérico:** validação do dígito verificador (exemplo oficial da Receita `12.ABC.345/01DE-35` confere) e cadastro de empresa aceitando letras. Antes, qualquer letra era apagada em silêncio. CNPJ numérico segue com o mesmo resultado.
- **S-3000 (exclusão):** `POST /esocial/events/:id/exclusion` cria o rascunho a partir de um evento **já processado, com recibo**. O original só vira `excluido` quando o S-3000 volta com recibo. Excluído o evento, o ASO/CAT pode ser enviado de novo.
- **S-2210 (CAT):** tabela `work_accidents` (dado de saúde, RLS forçada), API `/esocial/accidents`, diagnóstico com as regras condicionais do XSD (hora por tipo/data, óbito, local, reabertura com CAT de origem, aviso de prazo do MOS), e o mesmo pipeline autorizar, assinar, transmitir, consultar. Tela na seção 4 de `/empresa/esocial`.
- **Correção:** o histórico de eventos usava `now()` (igual dentro da transação) e a ordem dos passos podia sair trocada; agora usa `clock_timestamp()`.

## Migrations novas (aplicar em ordem, só adicionam ou relaxam restrições)
- `0070_esocial_s3000.sql`: tipo `S-3000`, estado `excluido`, coluna `target_event_id`, índices de unicidade.
- `0071_work_accidents.sql`: tabela `work_accidents` com RLS; `esocial_events` passa a aceitar `S-2210` (`aso_record_id` deixa de ser obrigatório e há `accident_id`, com restrição de origem por tipo).

## Verificado (ensaio descartável)
- e2e: S-3000 e CAT passam, cada um duas vezes, mais o regressivo de S-2220, RLS, isolamento, ASO, certificados e cadastro com CNPJ alfanumérico. Unitários 617/618 (a falha é a antiga `r2-get-object`). Frontend 138 testes e `tsc` limpos. A imagem sobe em modo produção (`/health` 200, rotas novas 401 sem token).
- XML do S-3000 e do S-2210 assinados passam no XSD oficial inteiro, incluindo reabertura/óbito com `catOrigem`.
- Nota de ensaio: o rate limit global (por IP) acumula no Redis entre suítes e gera 429 espúrio. Zerar o Redis (`FLUSHALL` no Redis descartável) entre suítes.

## NÃO verificado
- Nenhum envio real do S-3000 ou do S-2210. O eSocial pode rejeitar por regra de negócio que o XSD não expressa (por exemplo, códigos das Tabelas 13, 14, 15 e 17 e CID válidos para a data, vínculo anterior, CAT de origem).
- Os códigos de tabela dos testes são fictícios. Em uso real, quem emite a CAT informa os códigos das tabelas oficiais do eSocial.
- Feriados não entram no cálculo do aviso de prazo.

## Limites e decisões
- Dado de saúde (CID, lesão, atestado): sem envio a IA, escrita só pela empresa, leitura por empresa, técnico vinculado e admin. A retenção e a LGPD continuam dependendo de validação jurídica (E-16/E-17).
- A CAT não pode ser editada enquanto houver evento ativo; para corrigir, exclui-se o evento (S-3000) e edita-se. Retificação (`indRetif=2`) ainda não existe.
- Só S-2220 e S-2210 podem ser excluídos pelo S-3000. S-2240 continua pendente do inventário de risco.

## Para aplicar (a ordem é a mesma do primeiro lote; é sua decisão)
Backup, copiar `0070` e `0071` para `montese_backend:/app/db/migrations/` e `npm run db:migrate`, depois `docker tag` das duas imagens `candidate-esocial2-20261005` como `latest` e `docker compose up -d --no-deps backend frontend`. Rollback: tags `pre-esocial2-20261005` (criar antes) ou as atuais `pre-esocial-20261005`.

## Adendo 2 (2026-10-07): conferência com o Manual do Desenvolvedor v1.16 (agosto/2026)
- **CNPJ alfanumérico no lote.** O XSD de envio do Pacote v1.6 só aceita `nrInsc` numérico (`\d{8,15}`). O **Pacote v1.6-Alfa** (mesmo namespace e versão) aceita alfanumérico e é superset do numérico; o XSD de lote do módulo foi trocado por ele (VERIFICADO: arquivo oficial baixado em 2026-10-07). O eSocial só aceita letras **maiúsculas**; minúsculas invalidam o evento (v1.16, 6.9). O XSD do lote recusa minúscula (testado).
- **Certificado com CNPJ alfanumérico.** A extração do documento do titular (`pkcs12.util`) só entendia dígitos; agora entende CNPJ alfanumérico e padroniza em maiúsculas.
- **Código 203 do envio** ("lote já recebido e ainda na fila", v1.16, 7.5.10): passa a ser tratado como transmitido, com o protocolo. Antes caía em erro técnico.
- **SOAP.** O WSDL oficial publica só o binding SOAP 1.1 (confirmado); o envelope do módulo já era 1.1. O exemplo da seção 6.4 do manual usa o namespace SOAP 1.2 e está desatualizado.
- **Verificado:** unitários (21) e e2e (flow 6, CAT 2, cadastro 14) em ensaio descartável. A imagem `montese-backend:candidate-esocial2-20261005` foi reconstruída com estas correções.
- **Observação:** o certificado do transmissor alfanumérico depende de a AC emitir e-CNPJ alfanumérico; não há como testar sem um certificado real.
