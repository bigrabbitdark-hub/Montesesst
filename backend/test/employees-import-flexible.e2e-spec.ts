import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

async function buildTestXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Funcionários');
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('POST /employees/import-preview e /employees/import-mapped (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitName: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Import Flexivel Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    // createTenantWithUser não cria company_unit nenhuma (só tenant + user +
    // funcionário-fixture — ver db-test-helper.ts) — precisa criar explicitamente,
    // mesmo padrão usado pelos demais e2e-specs que precisam de uma filial.
    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Import Flexivel', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    unitName = unitRes.rows[0].name;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('preview: XLSX com cabeçalho não-padrão devolve mapeamento sugerido correto', async () => {
    const xlsx = await buildTestXlsx([
      ['Documento', 'Nome Completo', 'Unidade', 'Função'],
      ['12345678900', 'João Silva', unitName, 'Eletricista'],
    ]);

    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', xlsx, {
        filename: 'funcionarios.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.headers).toEqual(['Documento', 'Nome Completo', 'Unidade', 'Função']);
    expect(res.body.suggested_mapping).toEqual({ nome: 1, cpf: 0, cargo: 3, filial: 2 });
    expect(res.body.sample_rows).toEqual([['12345678900', 'João Silva', unitName, 'Eletricista']]);
    expect(res.body.total_rows).toBe(1);
  });

  it('preview: sem arquivo devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('preview: formato não suportado devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('conteudo'), { filename: 'foto.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('mapped: importa usando o mapeamento confirmado, CPF formatado é normalizado', async () => {
    const csv = 'Documento,Nome Completo,Unidade,Função\n123.456.789-01,Maria Souza,' + unitName + ',Técnica\n';

    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ nome: 1, cpf: 0, cargo: 3, filial: 2 }))
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toEqual([]);

    const listRes = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((e: any) => e.cpf === '12345678901')).toBe(true);
  });

  it('mapped: linha com CPF inválido vira erro, não derruba as demais', async () => {
    const csv =
      'Documento,Nome Completo,Unidade,Função\n123,Pedro Alves,' +
      unitName +
      ',Ajudante\n98765432100,Carla Lima,' +
      unitName +
      ',Supervisora\n';

    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ nome: 1, cpf: 0, cargo: 3, filial: 2 }))
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(1);
    expect(res.body.erros[0].motivo).toContain('CPF inválido');
  });

  it('mapped: mapeamento inválido (JSON malformado) devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', 'não é json')
      .attach('file', Buffer.from('nome,cpf\nx,y', 'utf-8'), { filename: 'f.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
  });
});
