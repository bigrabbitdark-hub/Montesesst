# Fontes normativas reais — export de disaster recovery

Achado da auditoria do Assistente (2026-09-28, C-2): as ~36 Normas
Regulamentadoras (NR) reais que sustentam o RAG normativo do Assistente
Montese SST foram cadastradas manualmente em produção em 2026-08-31.
`backend/db/seed.ts` só recria 7 fontes-placeholder (landing pages, não o
texto da norma) — sem este diretório, um ambiente novo (ou uma recuperação
de desastre) não tinha como reconstruir o conhecimento normativo do
Assistente a partir do controle de versão.

## O que tem aqui

- `manifest.json` — metadados das 36 fontes (entidade, código, título, URL
  oficial, hash do conteúdo).
- `<CODE>.txt` (ex.: `NR-01.txt`) — texto bruto real de cada norma, exportado
  de produção em 2026-09-28. **Cada arquivo foi conferido byte a byte**
  contra o `content_hash` (SHA-256) que já existia em `normative_documents`
  antes de entrar no repositório — nenhum texto foi digitado ou gerado por
  IA, é cópia fiel do que passou pela aprovação humana em produção.

É texto de norma federal pública (MTE/Fundacentro/TST/MPT) — não é dado de
cliente, não tem PII, não tem segredo. ~3MB no total.

## O que NÃO tem aqui

O **arquivo PDF original** de cada norma não está aqui — só o texto já
extraído (`raw_text`), que é o que efetivamente alimenta o RAG (chunking +
embedding). Rodar `db:reseed-normative-sources` recria o conhecimento
normativo (busca, citação, Verificador), mas o botão "baixar documento" no
admin não vai funcionar pros documentos recriados até alguém re-upload o
PDF de origem para o R2 — limitação aceita, não um bug silencioso.

## Como usar

```bash
npm run db:reseed-normative-sources
```

Não destrutivo por desenho: se uma fonte já tem um documento `vigente`
(qualquer hash), o script **pula** essa fonte e avisa — nunca sobrescreve.
Rodar contra um banco que já tem as 36 NRs reais (ex.: produção, por
engano) é seguro — vira um no-op, confirmado rodando de verdade em
2026-09-28 (36 puladas, 0 criadas, nenhuma chamada de embedding feita).

O caminho de criação (fonte nova → chunk → embedding real) também foi
verificado de verdade nesse mesmo dia, com uma fonte descartável
(`TEST-RESEED-DELETE-ME`, criada e apagada na hora) — não com um banco
vazio real do zero, que ainda é a verificação que falta antes de confiar
nisto como plano de disaster recovery testado ponta a ponta.

## Quando atualizar

Se uma NR real mudar de versão em produção (via o fluxo normal de
aprovação em `/normative-documents`), este export fica desatualizado. Não
há automação para mantê-lo em sincronia — é um snapshot, não um espelho
vivo. Regenerar quando fizer sentido (ex.: antes de uma migração de
ambiente), reexportando `raw_text` + `content_hash` de
`normative_documents WHERE status = 'vigente'`.
