import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /employees/import (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Import CSV');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sede',
        address_street: 'Rua Import',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('importa linhas válidas e reporta erro por linha nas inválidas, sem travar as demais', async () => {
    const csv = [
      'nome,cpf,cargo,filial',
      'Funcionário Um,11122233301,Operador,Sede',
      'Sem CPF Válido,123,Operador,Sede',
      'Filial Errada,11122233302,Operador,Filial Que Não Existe',
      'Funcionário Dois,11122233303,Técnico,Sede',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'funcionarios.csv');

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(2);
    expect(res.body.erros).toHaveLength(2);
    expect(res.body.erros.find((e: { linha: number }) => e.linha === 3).motivo).toMatch(/CPF inválido/);
    expect(res.body.erros.find((e: { linha: number }) => e.linha === 4).motivo).toMatch(/não encontrada/);
  });

  it('CPF duplicado numa linha não trava as linhas seguintes (prova do SAVEPOINT)', async () => {
    const csv = [
      'nome,cpf,cargo,filial',
      'Duplicado,11122233301,Operador,Sede', // já existe do teste anterior
      'Depois Do Duplicado,11122233304,Operador,Sede',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'funcionarios2.csv');

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros[0].motivo).toMatch(/já cadastrado/);
  });

  it('não deixa linha em branco no meio do arquivo desalinhar o número de linha reportado', async () => {
    const csv = [
      'nome,cpf,cargo,filial', // linha 1
      'Funcionário Válido,11122233306,Operador,Sede', // linha 2
      '', // linha 3 — em branco, não deve contar como linha de dado
      'Funcionário CPF Ruim,abc,Operador,Sede', // linha 4 — posição real no arquivo
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'com-linha-em-branco.csv');

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(1);
    // Sem o fix, o número reportado viria como 3 (pós-filtro), não 4 (posição real no arquivo).
    expect(res.body.erros[0].linha).toBe(4);
    expect(res.body.erros[0].motivo).toMatch(/CPF inválido/);
  });

  it('rejeita cabeçalho inválido', async () => {
    const csv = 'nome,cpf\nFulano,11122233305';

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'ruim.csv');

    expect(res.status).toBe(400);
  });
});
