import { INestApplication, ValidationPipe } from '@nestjs/common';
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

export function configureApp(app: INestApplication): void {
  // Backend nunca é exposto direto (sem "ports:" no docker-compose) — só
  // nginx alcança essa porta, então confiar no proxy é seguro aqui. Sem
  // isso, req.ip fica com o IP interno do container nginx em vez do
  // cliente real, inutilizando o IP registrado na trilha de auditoria.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
