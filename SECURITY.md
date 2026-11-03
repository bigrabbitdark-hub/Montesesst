# Política de segurança

O Montese SST é um SaaS multi-tenant que trata dados de Segurança e Saúde do Trabalho,
incluindo dados pessoais e de saúde. Levamos a segurança e o isolamento entre clientes a sério.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança.

Use o recurso *Report a vulnerability* da aba **Security** deste repositório (relato privado
do GitHub). Descreva o que encontrou, como reproduzir e o impacto que você imagina. Não inclua
dados reais de clientes.

Ao reportar, por favor:

- não acesse, altere ou apague dados de outros usuários ou clientes;
- não execute testes de negação de serviço nem varreduras automatizadas em produção;
- dê um prazo razoável para correção antes de qualquer divulgação.

## Escopo de maior interesse

- quebra do isolamento entre tenants (RLS) ou escalonamento de papel;
- falhas de autenticação, sessão ou autorização;
- exposição de segredos, credenciais ou dados pessoais;
- upload de arquivos e processamento de documentos.

## Segredos

Nenhum segredo (chaves, senhas, tokens, certificados reais) deve ser versionado. O arquivo
`.env` é ignorado pelo git; use apenas `.env.example` como modelo. Se encontrar um segredo
no repositório, reporte pelo canal privado acima.

## Dependências

As dependências são monitoradas pelo Dependabot e revisadas por `npm audit`. Atualizações de
versão maior (por exemplo `next` e `@nestjs/*`) são tratadas em branches próprias, com testes.
