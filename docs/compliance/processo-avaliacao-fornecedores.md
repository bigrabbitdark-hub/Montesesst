# Processo interno de avaliação de fornecedor novo

> Documento interno (não publicado no site) — a
> [Política de Subcontratação e Fornecedores](../../frontend/content/legal/fornecedores.mdx)
> pública referencia este processo (seção "Como escolhemos") sem
> reproduzir o checklist completo. Mesma postura do resto de
> `docs/compliance/`: escrito sem advogado envolvido, pontos ⚠️
> precisam de validação jurídica antes de virar compromisso público com
> prazo ou garantia específica.

## 1. Por que este processo existe

Hoje o Montese SST usa 3 fornecedores externos — Resend (e-mail),
Mercado Pago (pagamento), Cloudflare R2 (armazenamento de documentos).
Cada um foi escolhido por decisão técnica direta da equipe, sem um
checklist formalizado. Isso é aceitável pra 3 fornecedores conhecidos e
já em produção, mas cresce de risco a cada fornecedor novo — este
processo existe pra virar hábito **antes** do 4º.

## 2. O que checar antes de contratar um fornecedor novo

Pra qualquer fornecedor que vá processar dado pessoal (de conta ou de
funcionário de empresa cliente) em nome do Montese:

1. **Função exata e dado recebido.** Que problema esse fornecedor
   resolve, e qual o menor conjunto de dado que ele precisa pra
   resolver isso? (mesmo princípio já aplicado aos 3 atuais — ver
   tabela pública em `fornecedores.mdx`: cada um só recebe o que
   precisa pra sua função, nada além).
2. **Localização de processamento/armazenamento.** Onde o dado
   fisicamente fica? Isso decide se vira transferência internacional
   de dado (Art. 33 da LGPD) — mesma pergunta que só foi feita
   *depois* de adotar o Cloudflare R2, confirmando em 2026-08-27 que o
   bucket fica fora do Brasil (Eastern North America). **Daqui pra
   frente, essa pergunta precisa ser feita ANTES de adotar, não
   depois** — ver `lgpd-compliance.md` §8.
3. **Cláusula de proteção de dados disponível.** O fornecedor oferece
   um DPA (Data Processing Addendum) ou cláusula contratual
   equivalente? Existe uma versão que cobre transferência internacional
   se aplicável (SCCs ou equivalente)? Não decide sozinho se isso
   "resolve" a LGPD — só registra se existe, pra quem for validar
   juridicamente ter algo concreto pra analisar.
4. **Histórico público de segurança.** O fornecedor teve
   vazamento/incidente relevante conhecido? Publica alguma certificação
   (SOC 2, ISO 27001, etc.)? Não é uma exigência bloqueante — é
   informação que entra na decisão, registrada aqui pra não depender
   da memória de quem escolheu.
5. **Alternativa nacional equivalente existe?** Se sim, e o custo/
   funcionalidade forem comparáveis, prefira a alternativa que mantém o
   dado no Brasil — evita o problema do item 2 antes de começar. Se
   não for viável (como não é pro R2 hoje — object storage S3-compatible
   com o nível de confiabilidade necessário não tinha opção nacional
   equivalente conhecida no momento da escolha), documentar o porquê.
6. **Plano de saída.** Se for preciso trocar esse fornecedor depois
   (aumento de preço, mudança de política, incidente), o dado é
   exportável? Existe lock-in técnico sério? Não bloqueia a escolha,
   mas evita surpresa depois.

## 3. Quem decide e registra

Hoje, o fundador decide (mesmo papel de Encarregado/DPO acumulado,
`lgpd-compliance.md` §2) — não há um comitê nem processo de aprovação
formal, dado o tamanho da equipe. A decisão e as respostas do checklist
acima devem ser registradas neste documento (seção 4), não só na
memória de quem decidiu.

## 4. Fornecedores atuais — avaliação retroativa

Reconstruída em 2026-08-27, depois do processo formalizado acima —
nenhum dos 3 passou por este checklist no momento da escolha original,
isso é a aplicação retroativa pra ter o registro completo:

| Fornecedor | Função | Localização conhecida | DPA/cláusula disponível | Alternativa nacional considerada |
|---|---|---|---|---|
| Resend | Envio de e-mail transacional | Não confirmado formalmente — não verificado com o mesmo rigor usado pro R2 (item 2 do checklist não existia ainda quando foi adotado) | Não verificado | Não |
| Mercado Pago | Processamento de pagamento de assinatura | Brasil (empresa brasileira, processamento de pagamento sujeito a regulação do Banco Central) | Não verificado | N/A — é a opção nacional dominante para esse tipo de cobrança |
| Cloudflare R2 | Armazenamento de documentos (fichas de EPI, relatórios, laudos) | **Eastern North America (ENAM)**, confirmado em 2026-08-27 — ver `lgpd-compliance.md` §8 | Cloudflare oferece DPA + SCCs no modelo europeu (GDPR) — se isso serve de base sob a LGPD ainda não foi validado juridicamente | Não foi documentada uma comparação formal no momento da escolha |

⚠️ **Pendência:** confirmar a localização de processamento do Resend
com o mesmo rigor aplicado ao R2 — ainda não foi feito. Baixa
prioridade (Resend só processa e-mail transacional, não dado de saúde
ocupacional), mas fica registrado pra não ser esquecido.

## 5. Quando revisar

- Sempre que um fornecedor atual mudar termos de serviço, política de
  privacidade, ou preço de forma relevante.
- Antes de adotar qualquer fornecedor novo (4º em diante).
- Anualmente, como checagem de rotina — ainda não agendado formalmente
  (mesma limitação de "sem SLA formal" já registrada em
  `processo-incidentes.md` §1: equipe pequena, sem processo dedicado
  de revisão periódica ainda).
