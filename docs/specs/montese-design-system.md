# Montese SST — Design System

Recebido do proprietário em 2026-09-30 (texto colado na conversa, transcrito
sem alteração de conteúdo). Objetivo: identidade visual moderna, premium e
consistente para Dashboard, Auditoria Inteligente, eSocial, Empresas,
Funcionários, Relatórios, IA SST e aplicativo mobile.

> Status: **transcrição fiel, ainda não aplicada ao código.** O frontend da
> Fase 1 do dashboard (`/dashboard-v2`) foi construído com a spec anterior, que
> diverge deste documento em paleta, larguras, fonte e itens de menu. A
> decisão de qual prevalece está pendente com o proprietário (2026-09-30).

## 1. Princípios

A plataforma deve transmitir: segurança, confiabilidade, tecnologia,
organização, inteligência, conformidade legal. O usuário deve sentir que usa
uma plataforma robusta, preparada para auditorias, fiscalizações e gestão
completa de SST.

Inspirações: Stripe, Linear, Notion, Monday.com, ClickUp, SafetyCulture, Deel,
Sólides.

## 2. Identidade visual

| Grupo | Token | Valor |
|---|---|---|
| Sidebar | `--sidebar-bg` | `#0F172A` |
| | `--sidebar-hover` | `#1E293B` |
| | `--sidebar-active` | `#10B981` |
| Verde Montese | `--primary` | `#10B981` |
| | `--primary-dark` | `#059669` |
| | `--primary-light` | `#D1FAE5` |
| Status | `--success` | `#22C55E` |
| | `--warning` | `#F59E0B` |
| | `--danger` | `#EF4444` |
| | `--info` | `#3B82F6` |
| Fundos | `--background` | `#F8FAFC` |
| | `--card` | `#FFFFFF` |
| | `--border` | `#E2E8F0` |
| Texto | `--text-primary` | `#0F172A` |
| | `--text-secondary` | `#475569` |
| | `--text-muted` | `#94A3B8` |

## 3. Tipografia

Fonte principal: `Inter`. Alternativa: `"Plus Jakarta Sans"`.

| Nível | Tamanho | Peso |
|---|---|---|
| H1 (ex.: "Painel de Controle SST") | 48px | 700 |
| H2 | 32px | 700 |
| H3 | 24px | 600 |
| Texto | 16px | 400 |
| Pequeno | 14px | 400 |

## 4. Espaçamento

Múltiplos de 8: 4, 8, 16, 24, 32, 48, 64 px.

## 5. Bordas e sombras

- Radius padrão 18px; pequeno 12px; grande 24px.
- Card padrão: `box-shadow: 0 4px 12px rgba(15,23,42,.08)`.
- Card hover: `box-shadow: 0 10px 25px rgba(15,23,42,.12)`.

## 6. Layout principal

- **Sidebar** 280px, fundo `#0F172A`. Itens: Logo, Dashboard, Empresas,
  Funcionários, Documentos, Auditoria IA, eSocial, Relatórios, Financeiro,
  Universidade, Configurações.
- **Topbar** 72px: pesquisa global, notificações, IA SST, perfil.

## 7. Componentes

- **Card KPI** (ex.: "Conformidade Geral / 92% / +4% este mês"): fundo branco,
  radius 18px, padding 24px.
- **Card de documento** (ex.: PGR / Conforme / 95% / Atualizado).
- **Card de alerta** (ex.: "⚠ Documento vencendo / PCMSO / 15 dias restantes"),
  cor `warning`.

## 8. Dashboard principal — ordem dos blocos

1. Empresas · Funcionários · Documentos · Score SST
2. Conformidade por NR · Auditoria Inteligente · Pendências
3. eSocial · Vencimentos · Eventos Recentes

## 9. Score SST (componente mais importante)

Exibição em progresso circular (ex.: "92% — Excelente").

| Faixa | Cor |
|---|---|
| 0–59 | Vermelho |
| 60–79 | Laranja |
| 80–89 | Amarelo |
| 90–100 | Verde |

## 10. Auditoria Inteligente SST (principal diferencial)

Cruzamentos exibidos: PGR×LTCAT, PGR×PCMSO, PPP×LTCAT, PPP×eSocial, PGR×S2240,
PCMSO×S2220.

Prioridades e cores: Crítica `#EF4444` · Alta `#F97316` · Média `#F59E0B` ·
Baixa `#10B981`.

## 11. Assistente IA SST

Visual estilo chat. Exemplo de mensagem: "Olá, Diogo. Foram encontradas 7
inconsistências. Deseja gerar o relatório técnico?" Ações: Gerar PDF, Corrigir,
Abrir Auditoria, Exportar.

## 12. Gráficos

Usar Chart.js ou Recharts. Permitidos: barras, linhas, pizza, donut, área.
Proibidos: gráficos 3D, gradientes exagerados, gráficos poluídos.

## 13. Relatório PDF (visual executivo)

Capa: Montese SST, Relatório de Auditoria, nome da empresa, data. Conteúdo:
Resumo Executivo, Score SST, Não Conformidades, Plano de Ação, Documentos,
eSocial, Assinatura Digital.

## 14. Responsividade

Desktop 1440px+; notebook 1024px; tablet 768px (sidebar recolhível); mobile
360px+ (layout em cards).

## 15. Padrão visual

Sempre: moderna, premium, segura, tecnológica, corporativa, limpa, organizada,
confiável. Nunca: poluída, colorida demais, infantil, cheia de animações,
confusa.

**Regra de ouro:** toda tela deve responder em até 3 segundos "Minha empresa
está em conformidade?". Se não ajudar, deve ser simplificada ou redesenhada.
