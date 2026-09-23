import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JsonLoggerService } from './common/logging/json-logger.service';
import { validateProductionEnv } from './common/config/env.validator';

async function bootstrap() {
  // F-21: falha rápido em produção se variáveis de ambiente críticas
  // estiverem ausentes ou com placeholder conhecido. Tem que rodar ANTES
  // de NestFactory.create porque JwtModule.register lê process.env.JWT_SECRET
  // no momento do import do módulo.
  validateProductionEnv();

  const app = await NestFactory.create(AppModule, { logger: new JsonLoggerService() });
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
  const ALLOWED_ORIGINS = [
    process.env.PUBLIC_APP_URL,
    'https://montesesst.com.br',
    'https://www.montesesst.com.br',
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} não permitida`), false);
    },
    credentials: true,
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

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend Montese SST rodando na porta ${port}`);
}

bootstrap();

