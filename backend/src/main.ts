import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import { JsonLoggerService } from './common/logging/json-logger.service';
import { validateProductionEnv } from './common/config/env.validator';

async function bootstrap() {
  // F-21: falha rápido em produção se variáveis de ambiente críticas
  // estiverem ausentes ou com placeholder conhecido. Tem que rodar ANTES
  // de NestFactory.create porque JwtModule.register lê process.env.JWT_SECRET
  // no momento do import do módulo.
  validateProductionEnv();

  const app = await NestFactory.create(AppModule, { logger: new JsonLoggerService() });

  // trust proxy, helmet (F-20), CORS com allowlist (F-19) e ValidationPipe global (F-15):
  // ver app-setup.ts — a mesma função é usada pelos testes e2e.
  configureApp(app);

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend Montese SST rodando na porta ${port}`);
}

bootstrap();
