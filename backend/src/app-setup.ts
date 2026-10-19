import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';

// Configuração HTTP compartilhada entre o bootstrap real (main.ts) e os testes e2e
// (ITEM 025 da auditoria 2026-09-27: o hardening F-15/F-19/F-20 foi commitado sem teste).
// Extraída de main.ts SEM mudar comportamento; main.ts só a chama.

// F-19: allowlist de origens para CORS. Lida a cada chamada (e não no import) para que os
// testes possam variar PUBLIC_APP_URL.
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.PUBLIC_APP_URL, 'https://montesesst.com.br', 'https://www.montesesst.com.br'].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
}

// Rotas PÚBLICAS de assinatura eletrônica de EPI (sem login, em celular de funcionário).
export const PUBLIC_SIGNATURE_PATH = '/epi-signatures/public';
// A imagem da assinatura (PNG de até 200 KB) viaja em base64 (~273 mil caracteres): não cabe no limite padrão de 100 KB.
// 300 KB vale SÓ para o caminho acima; o limite global do Nest (100 KB) continua para todo o resto.
export const PUBLIC_SIGNATURE_BODY_LIMIT = '300kb';

// Cabeçalho no-store em TODA resposta das rotas públicas (inclusive 4xx/5xx e 413 do parser) e parser JSON com limite
// próprio. Registrado antes do parser padrão do Nest (que só é montado em app.init) para ter precedência neste caminho;
// o parser padrão ignora corpo já lido. Erros do parser (corpo grande demais, JSON inválido) viram 413/400 em JSON,
// nunca 500 nem página HTML com stack.
// Registrado ANTES de helmet e CORS: preflight (OPTIONS) e erro de CORS também saem com no-store.
export function applyPublicSignatureNoStore(app: INestApplication): void {
  app.use(PUBLIC_SIGNATURE_PATH, (_req: any, res: any, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}

export function configurePublicSignatureRoutes(app: INestApplication): void {
  // ATENÇÃO: o Nest só registra o parser padrão (100 KB) se não achar na pilha uma camada chamada "jsonParser". O `json()`
  // do express tem esse nome; embrulhado numa função anônima o Nest continua montando o parser global normalmente
  // (sem isso, TODAS as outras rotas ficariam sem corpo e o login devolveria 400).
  const publicJson = json({ limit: PUBLIC_SIGNATURE_BODY_LIMIT });
  app.use(
    PUBLIC_SIGNATURE_PATH,
    (req: any, res: any, next: (e?: unknown) => void) => publicJson(req, res, next),
    (err: any, _req: any, res: any, next: (e?: unknown) => void) => {
      if (!err?.type) return next(err); // erro que não é do body-parser segue para o tratador padrão
      const status = err.status === 413 || err.type === 'entity.too.large' ? 413 : 400;
      res.status(status).json({
        statusCode: status,
        message: status === 413 ? 'Corpo da requisição grande demais' : 'Corpo da requisição inválido',
      });
    },
  );
}

export function configureApp(app: INestApplication): void {
  // Backend nunca é exposto direto (sem "ports:" no docker-compose) — só
  // nginx alcança essa porta, então confiar no proxy é seguro aqui. Sem
  // isso, req.ip fica com o IP interno do container nginx em vez do
  // cliente real, inutilizando o IP registrado na trilha de auditoria.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  applyPublicSignatureNoStore(app);

  // F-20: helmet adiciona X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, X-DNS-Prefetch-Control
  // e remove o header X-Powered-By (não vaza "Express"). O nginx
  // adiciona headers complementares (CSP, Permissions-Policy).
  app.use(helmet());

  // F-19: allowlist de origens para CORS. Sem argumentos, o NestJS
  // responde Access-Control-Allow-Origin: * em qualquer rota — pré-configura
  // mal o sistema para o dia que algum endpoint passar a aceitar credenciais
  // via cookie. Pedidos sem Origin (curl, server-to-server, mobile nativo)
  // continuam permitidos.
  const origins = allowedOrigins();
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} não permitida`), false);
    },
    // ITEM 027: o sistema NÃO usa cookies (a sessão é um Bearer token em Authorization),
    // então não há por que autorizar o navegador a enviar credenciais em requisições
    // cross-origin. Ligar isto de novo exige revisar antes o risco de CSRF.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    maxAge: 86400,
  });

  configurePublicSignatureRoutes(app);

  // F-15: ValidationPipe global. Sem ele, DTOs sem decorators de classe
  // (ex.: LoginDto antes deste fix) aceitavam qualquer shape de corpo —
  // combinação de F-21 (sem JWT_SECRET) + F-15 = vetor de bypass de auth
  // trivial. whitelist+forbidNonWhitelisted rejeita propriedades extras
  // (defesa contra mass assignment); transform=true converte tipos
  // (string→number) coerentemente.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
