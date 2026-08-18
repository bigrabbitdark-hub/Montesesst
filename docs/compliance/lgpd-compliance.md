# LGPD / Compliance — Montese SST

> **Postura deste documento:** ponto de partida técnico, escrito sem
> advogado ou consultoria de LGPD envolvida no projeto (confirmado com o
> fundador em 2026-08-18). Cobre o mínimo para operar legalmente — mapeamento
> de dados, base legal, retenção, processo de direitos do titular — não
> inclui ainda funcionalidades de autoatendimento do titular (isso vira fase
> técnica separada, quando a demanda justificar). **Pontos marcados com ⚠️
> precisam de revisão jurídica antes de serem tratados como definitivos.**
>
> Ver também [`docs/vision.md`](../vision.md) seção 9 (compromissos de
> confiança) e [`docs/roadmap.md`](../roadmap.md) para o estado técnico geral.

## 1. Escopo e postura

Esta spec cobre a Lei Geral de Proteção de Dados (Lei 13.709/2018) aplicada
ao que o Montese já processa (Fase 1: cadastro de empresa, usuários,
funcionários) e ao que as Fases 4-5 vão adicionar (documentos de SST,
inclusive dado de saúde ocupacional). O alvo é o **mínimo legal para operar
e vender com segurança**, não um programa de compliance completo. Onde a lei
exige uma decisão que só um advogado pode validar com segurança, este
documento sinaliza isso explicitamente em vez de decidir por conta própria.

## 2. Papéis e responsabilidades

### Encarregado (DPO)

O fundador assume o papel de Encarregado (Art. 41 da LGPD) provisoriamente.
⚠️ **Pendência:** a LGPD exige um canal de contato público e claro para o
Encarregado (normalmente um e-mail tipo `privacidade@montesesst.com.br`
divulgado no site institucional). Isso depende da Fase 2 (site) existir —
ver seção 9.

### Controlador vs. operador — distinção que muda quem responde pelo quê

Esta é a decisão estrutural mais importante desta spec:

- Para **dados de funcionários da empresa cliente** (CPF, ASO, ficha de EPI,
  relatórios de inspeção — tudo que fica em `employees` e nas tabelas
  futuras de documentos), **o Montese é operador** (processa em nome da
  empresa cliente) e **a empresa cliente é a controladora** (decide por que
  coleta e o que faz com aquele dado — é ela quem tem a relação
  trabalhista com o funcionário).
- Para **dados de conta da própria plataforma** (e-mail, telefone, senha de
  login em `users` — de usuários com papel `empresa`, `tecnico`, `parceiro`),
  **o Montese é controlador**: é o Montese quem decide como esses dados de
  conta são usados.

**Implicação prática:** como operador, o Montese precisa (a) só processar
dados de funcionários dentro do que a empresa cliente autorizou/instruiu,
(b) garantir segurança técnica compatível (RLS, backup, controle de acesso —
já em vigor, ver seção 8), e (c) ter isso **registrado em contrato** com
cada empresa cliente (cláusula de tratamento de dados nos Termos de Uso da
Fase 2 — ⚠️ ainda não escrita, apenas sinalizada aqui como dependência).

## 3. Inventário de dados pessoais

| Dado | Onde | Titular | Sensível? | Fase |
|---|---|---|---|---|
| E-mail, telefone, nome completo (conta de login) | `users.email`, `users.phone`, `users.full_name` | Usuário da plataforma (empresa/técnico/parceiro/admin) | Não | ✅ Fase 1 |
| Senha (hash bcrypt, nunca em texto puro) | `users.password_hash` | idem | Não (dado de segurança, não pessoal per se) | ✅ Fase 1 |
| CPF | `employees.cpf` | Funcionário da empresa cliente | Não (mas identificador único sensível a vazamento) | ✅ Fase 1 |
| Nome completo, cargo, data de nascimento, data de admissão | `employees.*` | Funcionário da empresa cliente | Não | ✅ Fase 1 |
| CNPJ, razão social | `tenants.name`, `tenants.cnpj` | Empresa cliente (pessoa jurídica — LGPD não se aplica a PJ diretamente, mas o CNPJ pode identificar indiretamente sócios em empresas pequenas) | Não | ✅ Fase 1 |
| Registro profissional (CREA/etc), especialização | `technicians.*` | Técnico responsável | Não | ✅ Fase 1 |
| Região de atuação | `partners.*` | Técnico parceiro | Não | ✅ Fase 1 |
| ASO (Atestado de Saúde Ocupacional), resultado de exames | Fase 4/5, ainda sem tabela — ver `docs/reference/modelos-relatorios-sst.md` | Funcionário da empresa cliente | **⚠️ SIM — dado de saúde (Art. 5º, II)** | 🔜 Fase 4/5 |
| Fotos/assinaturas em relatórios de visita técnica | Fase 5/6, ainda sem tabela | Funcionário, técnico | Pode ser (imagem de pessoa identificável) | 🔜 Fase 5/6 |
| Ficha de EPI (uso, entrega, assinatura) | Fase 4/5 | Funcionário | Não diretamente, mas vinculado a dado de saúde ocupacional (risco/exposição) | 🔜 Fase 4/5 |

## 4. Base legal por categoria

Para a maior parte dos dados de SST, a base legal correta é **cumprimento de
obrigação legal ou regulatória** (Art. 7º, II — as Normas Regulamentadoras
exigem que a empresa mantenha esses registros), não consentimento. Isso é
deliberado: consentimento pode ser revogado a qualquer momento pelo titular,
e um funcionário não pode "revogar" o direito da empresa de manter seu
prontuário de SST em dia — a obrigação é legal, não uma escolha do
funcionário. Usar consentimento como base aqui seria um erro comum.

- **Dados de conta de login** (`users`): execução de contrato (Art. 7º, V) —
  a pessoa está contratando/usando o serviço.
- **Dados de funcionários** (`employees`, e futuramente ASO/exames):
  cumprimento de obrigação legal (Art. 7º, II para dado comum; **Art. 11,
  II, "a" para dado sensível de saúde**, quando a Fase 4/5 chegar) —
  responsabilidade da empresa cliente enquanto controladora (seção 2), o
  Montese processa como operador dessa base legal já estabelecida por ela.
- **Dados de técnicos/parceiros**: execução de contrato (prestação de
  serviço).

⚠️ Confirmar com jurídico antes da Fase 4/5: a base do Art. 11 para dado de
saúde tem exigências adicionais de segurança e, em alguns casos, exige que o
tratamento seja "indispensável" — vale revisão específica quando o schema de
`epi_records`/`inspections` for desenhado.

## 5. Retenção

Não existe hoje nenhuma rotina de expurgo/anonimização — dado fica
indefinidamente. Isso não é sustentável para dado sensível de saúde.

- **Dados de conta e cadastro** (`users`, `employees` sem envolvimento de
  saúde): reter enquanto o contrato com a empresa cliente estiver ativo +
  prazo de prescrição de eventuais ações trabalhistas (prática comum: 5
  anos após o fim do vínculo). ⚠️ Confirmar prazo exato com jurídico.
- **Documentos de saúde ocupacional (PCMSO/ASO)**: a prática do setor de SST
  no Brasil (ligada a normas de medicina do trabalho, não só à LGPD) costuma
  exigir retenção bem mais longa — frequentemente citada como **~20 anos
  após o fim do vínculo empregatício**, por causa de doenças ocupacionais de
  latência longa. **⚠️ Esta cifra é prática comum do setor, não uma
  confirmação jurídica formal — precisa ser validada com um especialista em
  medicina/segurança do trabalho ou advogado antes de virar regra no
  sistema.** Isso vira campo de configuração (`retention_until` ou similar)
  quando o schema de documentos for desenhado nas Fases 4/5, não uma data
  fixa no código.
- **Ação recomendada agora:** nenhuma mudança de schema ainda (não há dado
  de saúde no sistema hoje). Registrar esta pendência para não ser
  esquecida quando a Fase 4 começar.

## 6. Direitos do titular (processo manual)

Sem portal de autoatendimento ainda (decisão do fundador para esta fase).
Processo até lá:

1. Pedido chega por qualquer canal (e-mail, WhatsApp, etc.) ao Encarregado
   (fundador, por ora).
2. Fundador verifica identidade do titular e qual empresa cliente controla
   aquele dado (se for funcionário) — se for dado de funcionário, a empresa
   cliente controladora deve ser informada/envolvida, já que o Montese é só
   operador (seção 2).
3. Resposta em até 15 dias (prazo usual da LGPD para resposta imediata,
   prorrogável) — ⚠️ confirmar prazo exato aplicável ao caso com jurídico.
4. Acesso/correção: hoje só é possível via acesso direto ao banco (não há
   tela para isso) — tecnicamente viável (RLS já isola por tenant), mas
   operacionalmente manual.
5. Exclusão: mesma limitação — exclusão manual via banco, respeitando
   retenção obrigatória (seção 5) quando aplicável.

**Isso é aceitável para o volume atual (zero clientes reais em produção),
mas não escala.** Quando o número de clientes pagantes crescer, a falta de
uma tela de autoatendimento vira risco operacional real, não só de
compliance — fica registrado aqui para entrar como prioridade técnica
futura.

## 7. Dados sensíveis — controles adicionais (Fase 4/5)

Quando ASO/exames entrarem no schema:

- RLS já garante isolamento por tenant (herda o padrão de `employees`) —
  não é trabalho novo, é reaproveitar o padrão já validado.
- Acesso a esse campo específico deveria ser mais restrito que o resto do
  cadastro do funcionário — ⚠️ avaliar, no desenho do schema da Fase 4/5, se
  a RLS por tenant é suficiente ou se precisa de uma policy adicional
  restringindo por role dentro do próprio tenant (ex.: nem todo usuário
  `empresa` do RH deveria ver detalhe clínico do exame, só o resultado
  apto/inapto).
- Nunca em disco da VPS — já é regra não-negociável (`docs/vision.md` seção
  8) e vale com força redobrada aqui.
- Auditoria de acesso a esse dado especificamente é mais crítica que para o
  resto — ver spec futura de Escala + Auditoria.

## 8. O que a arquitetura já garante hoje (evidência, não trabalho novo)

Já implementado e testado (`backend/test/rls-isolation.e2e-spec.ts`), serve
de base para qualquer alegação de segurança em auditoria futura:

- Isolamento entre empresas clientes via RLS em toda tabela (`FORCE ROW
  LEVEL SECURITY`), testado automaticamente.
- Senha nunca em texto puro — hash bcrypt.
- Segredos (`.env`) nunca versionados em git.
- Postgres e Redis nunca expostos publicamente, só rede Docker interna.
- Regra de object storage externo para documentos (ainda não implementada
  porque upload ainda não existe, mas já é decisão registrada antes de
  codificar — `docs/vision.md` seção 8).

⚠️ **Pendência não relacionada a código:** verificar em qual região/país o
VPS atual e o futuro bucket R2 estão fisicamente hospedados. Se dado pessoal
sair do Brasil, isso é "transferência internacional de dados" (Art. 33 da
LGPD) e precisa de uma base legal própria — não é automático só porque o
provedor é confiável.

## 9. Dependência com a Fase 2 (site institucional)

Dois artefatos legais precisam existir no site institucional antes de captar
o primeiro cliente pagante:

- **Política de Privacidade** — publicada, linkada no rodapé, cobrindo o
  inventário da seção 3 em linguagem acessível ao titular.
- **Termos de Uso** — incluindo a cláusula de operador/controlador da seção
  2 (o que o Montese faz com o dado do funcionário em nome da empresa
  cliente).

Nenhum dos dois existe ainda porque a Fase 2 não começou. Registrado aqui
como bloqueio explícito: **a Fase 2 não deveria ser considerada concluída
sem esses dois documentos publicados**, mesmo que o roadmap técnico da Fase
2 não os liste originalmente.

## 10. Checklist priorizado

**Já cumprido (evidência na seção 8):**
- [x] RLS multi-tenant testada automaticamente
- [x] Senhas com hash, nunca texto puro
- [x] Segredos fora do git
- [x] Banco/Redis não expostos publicamente

**Antes de vender para o primeiro cliente pagante:**
- [ ] Definir e publicar canal de contato do Encarregado (depende da Fase 2)
- [ ] Escrever e publicar Política de Privacidade (depende da Fase 2)
- [ ] Escrever e publicar Termos de Uso com cláusula operador/controlador
      (depende da Fase 2)
- [ ] Confirmar com jurídico: prazo de retenção de dados de conta/cadastro
      (seção 5)
- [ ] Confirmar região de hospedagem do VPS e do futuro bucket R2 (seção 8)

**Antes de processar dado de saúde ocupacional (Fase 4/5):**
- [ ] Validar com especialista em SST/jurídico o prazo real de retenção de
      ASO/PCMSO (seção 5)
- [ ] Decidir, no desenho do schema, se RLS por tenant basta ou se precisa
      de policy adicional por role para dado clínico (seção 7)
- [ ] Confirmar base legal específica do Art. 11 aplicável (seção 4)

**Fora de escopo desta spec (fase técnica futura, não agora):**
- Portal de autoatendimento do titular (acesso/correção/exclusão via tela)
- Anonimização/expurgo automatizado por retenção vencida
- Registro formal de operações de tratamento (livro do Art. 37) — este
  documento já cumpre boa parte dessa função informalmente
