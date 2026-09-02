import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AUDIO_TRANSCRIPTION_SERVICE } from '../src/cipa/ata-ai/audio-transcription.interface';
import { ATA_EXTRACTOR } from '../src/cipa/ata-ai/ata-extractor.interface';
import { TestDb } from './db-test-helper';

describe('POST /cipa/meetings/:id/ata-audio, GET :id/ata-ai-draft (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  const fakeTranscriber = { transcribe: jest.fn() };
  const fakeExtractor = { extract: jest.fn() };

  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let approvedMeetingId: string;
  let empresaToken: string;

  async function waitForDraftStatus(id: string, token: string, notStatus: string) {
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .get(`/cipa/meetings/${id}/ata-ai-draft`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body?.status !== notStatus) return res.body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Rascunho da reunião ${id} não saiu do status "${notStatus}" a tempo`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIO_TRANSCRIPTION_SERVICE)
      .useValue(fakeTranscriber)
      .overrideProvider(ATA_EXTRACTOR)
      .useValue(fakeExtractor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Ata IA Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const committeeResult = await (db as any).client.query(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, 2026, '2026-01-01', '2026-12-31', $3) RETURNING id`,
      [tenantId, companyUnitId, userId],
    );
    committeeId = committeeResult.rows[0].id;

    const meetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Ata IA', '2026-03-10') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    meetingId = meetingResult.rows[0].id;

    const approvedMeetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data, status_ata)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Já Aprovada Teste', '2026-03-11', 'aprovada') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    approvedMeetingId = approvedMeetingResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterEach(() => {
    fakeTranscriber.transcribe.mockReset();
    fakeExtractor.extract.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('faz upload, processa em segundo plano e conclui com os 3 campos', async () => {
    fakeTranscriber.transcribe.mockResolvedValue('Transcrição: discutido uso de EPI e reposição de luvas.');
    fakeExtractor.extract.mockResolvedValue({
      pauta: 'Uso de EPI',
      discussoes: 'Reposição de luvas danificadas',
      deliberacoes: 'Comprar luvas novas até sexta',
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('conteudo-fake-de-audio'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe('processando');

    const finalDraft = await waitForDraftStatus(meetingId, empresaToken, 'processando');
    expect(finalDraft.status).toBe('concluido');
    expect(finalDraft.transcript).toBe('Transcrição: discutido uso de EPI e reposição de luvas.');
    expect(finalDraft.draft_pauta).toBe('Uso de EPI');
    expect(finalDraft.draft_discussoes).toBe('Reposição de luvas danificadas');
    expect(finalDraft.draft_deliberacoes).toBe('Comprar luvas novas até sexta');
    expect(fakeTranscriber.transcribe).toHaveBeenCalledTimes(1);
    expect(fakeExtractor.extract).toHaveBeenCalledWith('Transcrição: discutido uso de EPI e reposição de luvas.');
  });

  it('rejeita formato de arquivo não suportado com 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('nao-e-audio'), { filename: 'texto.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('rejeita upload numa reunião com ata já aprovada com 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${approvedMeetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(409);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('rejeita upload enquanto já existe um rascunho "processando" com 409', async () => {
    // Upsert, não INSERT puro — o teste anterior ("faz upload, processa em
    // segundo plano...") já deixou uma linha 'concluido' pra este mesmo
    // meetingId (meeting_id é UNIQUE em cipa_meeting_ata_drafts), então um
    // INSERT simples aqui colidiria com a constraint. Mesmo padrão de
    // upsert de AtaAiService.createDraft.
    await (db as any).client.query(
      `INSERT INTO cipa_meeting_ata_drafts (meeting_id, tenant_id, company_unit_id, status)
       VALUES ($1, $2, $3, 'processando')
       ON CONFLICT (meeting_id) DO UPDATE SET status = 'processando'`,
      [meetingId, tenantId, companyUnitId],
    );

    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(409);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();

    // Limpa pra não vazar pro próximo teste (meetingId é reusado acima).
    await (db as any).client.query('DELETE FROM cipa_meeting_ata_drafts WHERE meeting_id = $1', [meetingId]);
  });

  it('falha na transcrição grava status "falhou" com mensagem, sem travar o rascunho em "processando"', async () => {
    fakeTranscriber.transcribe.mockRejectedValue(new Error('Não foi possível transcrever o áudio agora'));

    const uploadRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(uploadRes.status).toBe(201);

    const finalDraft = await waitForDraftStatus(meetingId, empresaToken, 'processando');
    expect(finalDraft.status).toBe('falhou');
    expect(finalDraft.error_message).toBe('Não foi possível transcrever o áudio agora');
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });

  it('GET sem nenhum upload prévio devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/meetings/${approvedMeetingId}/ata-ai-draft`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(404);
  });
});
