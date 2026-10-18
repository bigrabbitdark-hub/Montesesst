# PCMSO, ASO e saúde ocupacional — insumos para o módulo de produto (resumo do material do proprietário)

> **Origem:** texto colado pelo proprietário em 2026-10-10 ("PCMSO e ASO: saúde ocupacional, requisitos legais e fontes oficiais"). Este arquivo é um **resumo em palavras
> próprias**, não a transcrição, e **não é texto normativo nem fonte de regra**. O que tem fundamento literal está nas regras `rascunho` de
> `backend/db/seed-data/normative-rules/saude-ocupacional-nr07.json` e `saude-ocupacional.json` (cada ligação com o item e um fragmento literal conferido). Aqui ficam as ideias de **produto**, que exigem
> projeto próprio (brainstorming → spec → plano) antes de qualquer código. Marcadores: VERIFICADO (conferido nos textos oficiais em 2026-10-10) / NÃO VERIFICADO.

## 1. Estado da base normativa (VERIFICADO)
- **NR-07 do Assistente está atual:** o texto em produção é idêntico, byte a byte, ao PDF oficial publicado hoje (`nr-07-atualizada-2022-1.pdf`; página do MTE atualizada em
  02/06/2025; última portaria listada: SEPRT nº 8.873/2021). Limite: vale até a data da página — não substitui o DOU. A NR-07 **não tem o problema de URL desatualizada da NR-01**.
- Itens que o material cita e que existem no texto: 7.5.1 (PCMSO a partir dos riscos do PGR), 7.5.6 (exames obrigatórios), 7.5.8 (prazos e periodicidade), 7.5.9 (retorno ao trabalho),
  7.5.10 (mudança de risco), 7.5.11 (demissional), 7.5.19 e 7.5.19.1 (ASO e seu conteúdo mínimo, incluindo CAEPF), 7.6.1–7.6.3 (prontuário e relatório analítico).
- CLT art. 168 (exame médico por conta do empregador, §§1º–3º) e art. 169 (notificação de doenças): VERIFICADOS no texto vigente extraído do Planalto.
- LGPD (Lei 13.709/2018): texto no Planalto acessível (HTTP 200), **fonte ainda não cadastrada**; arts. 6, 7, 11, 46 e 48 reconhecidos pelo parser; o art. 5 (definições, inclusive
  dado pessoal sensível) exigia correção do parser, já feita (Task 1 do plano da área: o art. 57 vetado tinha o número partido em dois `<span>`); o art. 5 passou a ser
  reconhecido.

## 2. O que o material afirma e NÃO foi verificado
Prazo do evento S-2220 (até o dia 15 do mês seguinte ao ASO; ASO admissional até o dia 15 do mês seguinte à admissão; postergação em dia não útil), versão do MOS S-1.3 e
"Nota Orientativa S-1.3 nº 08/2026", Tabela 24 e leiaute do S-2220: **NÃO VERIFICADO** (nenhuma fonte do eSocial ingerida; URLs oficiais não verificadas). ANPD e o portal de
orientações: NÃO VERIFICADO. Listas "ilustrativas" de exames complementares (audiometria, espirometria, laboratoriais): o material as declara ilustrativas; não são regra.

## 3. Princípios do material (comportamento do sistema/Assistente — não são norma)
- O PCMSO não é calendário de exames; é planejado a partir dos riscos do PGR. A plataforma **organiza, sinaliza, controla prazos e dá trilha de auditoria**, sem assumir
  responsabilidade médica e **sem gerar PCMSO "como se fosse elaborado e validado pelo médico responsável"**.
- A IA **não diagnostica, não altera resultado, não assina e não decide aptidão**; ASO não substitui prontuário; relatório analítico não expõe diagnóstico individual a quem não tem
  necessidade legal. Prazo de transmissão ao eSocial **não prorroga** o prazo do exame (afirmação de cunho normativo do material: **NÃO VERIFICADO**; nenhuma fonte do eSocial ingerida). Validar XML localmente ≠ evento aceito: registrar protocolo, recibo e retorno oficial.
- Quando faltar informação, o resultado correto é **"pendente de verificação"**, não uma conclusão. Exceções (MEI/ME/EPP) exigem checar enquadramento e grau de risco; dispensa de
  PCMSO não é dispensa geral de exames ou de outras obrigações de SST.
Candidatos a `docs/assistente-montese-principios.md`; **não alteram prompt, provider ou modelo** (AGENTS.md exige autorização).

## 4. Dados de saúde (LGPD) — requisitos de produto sugeridos
Separação entre registros médicos e administrativos; permissões distintas (RH, técnico de segurança, médico, administrador, trabalhador); minimização; trilha de auditoria de
consultas, alterações, exportações e compartilhamentos; criptografia, retenção, backups protegidos; **IA com acesso limitado** — não enviar prontuários nem resultados
identificáveis a modelos externos sem análise jurídica, base legal e controles (AGENTS.md: minimização e PII antes de enviar dados ao modelo); gestão de incidentes. Fundamento literal
ligado no seed (só o que o texto diz): LGPD arts. 5º II (dado sensível), 11, 46 e 48 — depois da correção do parser e do cadastro da fonte.

## 5. Cruzamentos sugeridos (ideia de produto)
PGR×PCMSO; PCMSO×ASO; ASO×S-2220; cadastro funcional×ASO; mudança de riscos×PCMSO/ASO; exames complementares×PCMSO/S-2220; relatório analítico×PGR/plano de ação.
Saída da IA: origem, evidência, regra aplicável e ação recomendada. O pente-fino já tem verificação PCMSO↔PGR (Fase 25) e há um módulo eSocial S-2220 em worktree
(`/opt/montese-esocial`, "pronto, nada em produção"): **partir do que existe** (AGENTS.md: não duplicar).

## 6. Estrutura do módulo e modelo de dados propostos no material (NÃO é afirmação de que existam)
Gestão do PCMSO; agenda ocupacional; gestão do ASO; exames complementares; integração S-2220; auditoria assistida por IA. Entidades sugeridas: `pcmso_programs`,
`occupational_exam_schedule`, `aso_records`, `medical_exam_records`, `esocial_s2220_events`, `medical_access_audit`, `occupational_health_findings`. Antes de modelar, **verificar o que
já existe** (o eSocial em worktree tem eventos e `aso_module` — migration `0067_aso_module` já aplicada em produção).

## 7. Checklist do material (conferência interna, não certificação)
PCMSO (identificação, integração com PGR, planejamento, responsabilidade médica, relatório analítico); ASO (dados do empregado e função, riscos, exames e datas, conclusão de
aptidão pelo médico, assinatura e registros, disponibilização ao trabalhador); eSocial e privacidade (S-2220 conforme leiaute vigente, prazo monitorado, retorno oficial e recibo
armazenados, acesso restrito, trilha de auditoria).
