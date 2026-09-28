import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { allowedOrigins, configureApp } from '../src/app-setup';

// ITEM 025 (auditoria 2026-09-27): o hardening de segurança HTTP (F-15 ValidationPipe global,
// F-19 allowlist de CORS, F-20 helmet, trust proxy) foi commitado sem nenhum teste; a
// validação foi só narrativa. `configureApp` é a MESMA função que main.ts chama, então estes
// testes exercitam a configuração de produção — não uma cópia. (Antes, os e2e usavam
// Test.createNestApplication() puro e NÃO tinham o ValidationPipe global de produção.)
const APP_ORIGIN = 'https://app.teste.montese.local';

describe('Configuração HTTP de produção — configureApp (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    process.env.PUBLIC_APP_URL = APP_ORIGIN;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('helmet (F-20)', () => {
    it('devolve os cabeçalhos de segurança e não vaza "Express"', async () => {
      const res = await request(server()).get('/plans');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['referrer-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('também nas respostas de erro (404 e 401), não só nas de sucesso', async () => {
      for (const res of [await request(server()).get('/rota-que-nao-existe'), await request(server()).get('/auth/me')]) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });
  });

  describe('CORS com allowlist (F-19)', () => {
    it.each([APP_ORIGIN, 'https://montesesst.com.br', 'https://www.montesesst.com.br'])(
      'origem permitida (%s) recebe Access-Control-Allow-Origin igual à origem — nunca "*"',
      async (origin) => {
        const res = await request(server()).get('/plans').set('Origin', origin);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
      },
    );

    it('origem NÃO listada não recebe Access-Control-Allow-Origin (nem "*") e a requisição é recusada', async () => {
      for (const origin of ['https://evil.example.com', 'http://montesesst.com.br', 'https://montesesst.com.br.evil.com']) {
        const res = await request(server()).get('/plans').set('Origin', origin);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('sem Origin (curl, servidor a servidor, app nativo) continua permitido', async () => {
      const res = await request(server()).get('/plans');
      expect(res.status).toBe(200);
    });

    it('NÃO autoriza credenciais cross-origin (o sistema não usa cookies — ITEM 027)', async () => {
      const res = await request(server()).get('/plans').set('Origin', APP_ORIGIN);
      expect(res.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      const preflight = await request(server())
        .options('/auth/login')
        .set('Origin', APP_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('preflight de origem permitida: só os métodos e cabeçalhos da lista, com cache de 24 h', async () => {
      const res = await request(server())
        .options('/auth/login')
        .set('Origin', APP_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
      expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,PUT,DELETE,OPTIONS');
      expect(res.headers['access-control-allow-headers']).toBe('Authorization,Content-Type,X-Request-Id');
      expect(res.headers['access-control-max-age']).toBe('86400');
    });

    it('preflight de origem NÃO permitida não é autorizado', async () => {
      const res = await request(server())
        .options('/auth/login')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('ValidationPipe global (F-15) — em rota SEM @UsePipes próprio (POST /auth/login)', () => {
    const login = (body: unknown) => request(server()).post('/auth/login').send(body as object);

    it('propriedade extra no corpo é recusada com 400 (mass assignment)', async () => {
      const res = await login({ email: 'a@b.com', password: 'x', role: 'admin' });
      expect(res.status).toBe(400);
    });

    it('tipo errado e campos ausentes são 400 (não 500, não passa adiante)', async () => {
      expect((await login({ email: 123, password: 'x' })).status).toBe(400);
      expect((await login({ email: 'a@b.com' })).status).toBe(400);
      expect((await login({ email: 'nao-e-email', password: 'x' })).status).toBe(400);
      expect((await login({})).status).toBe(400);
      expect((await login({ email: { $ne: null }, password: { $ne: null } })).status).toBe(400);
    });

    it('corpo válido passa pela validação (chega à autenticação: 401, não 400)', async () => {
      const res = await login({ email: 'nao-existe-validacao@example.invalid', password: 'qualquer' });
      expect(res.status).toBe(401);
    });
  });

  describe('trust proxy', () => {
    it('confia em 1 proxy (nginx): o IP do cliente vem de X-Forwarded-For, não do container do proxy', () => {
      expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
    });
  });

  describe('allowedOrigins', () => {
    it('inclui PUBLIC_APP_URL e os dois domínios de produção', () => {
      expect(allowedOrigins({ PUBLIC_APP_URL: 'https://x.example' })).toEqual([
        'https://x.example',
        'https://montesesst.com.br',
        'https://www.montesesst.com.br',
      ]);
    });

    it('ignora PUBLIC_APP_URL ausente ou vazia (nunca vira "undefined" nem string vazia na lista)', () => {
      const expected = ['https://montesesst.com.br', 'https://www.montesesst.com.br'];
      expect(allowedOrigins({})).toEqual(expected);
      expect(allowedOrigins({ PUBLIC_APP_URL: '' })).toEqual(expected);
    });
  });
});
