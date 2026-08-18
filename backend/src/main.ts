import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Backend nunca é exposto direto (sem "ports:" no docker-compose) — só
  // nginx alcança essa porta, então confiar no proxy é seguro aqui. Sem
  // isso, req.ip fica com o IP interno do container nginx em vez do
  // cliente real, inutilizando o IP registrado na trilha de auditoria.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  console.log(`Backend Montese SST rodando na porta ${port}`);
}

bootstrap();
