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
  let staleDraftMeetingId: string;
  let noGroqKeyMeetingId: string;
  let empresaToken: string;
  let originalGroqApiKey: string | undefined;

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
    // Achado da revisão final (Finding 2): MeetingsController.uploadAtaAudio
    // agora recusa com 503 direto quando process.env.GROQ_API_KEY está
    // vazia — em produção ela fica vazia de propósito (ver .env), e este
    // arquivo inteiro testa o pipeline via fakeTranscriber/fakeExtractor
    // (nunca chama o Groq de verdade), então fixamos uma chave falsa aqui
    // pra não depender do ambiente onde os testes rodam ter uma
    // GROQ_API_KEY real. O teste que cobre o comportamento SEM chave
    // (Finding 2) remove e restaura isso localmente, dentro do próprio it.
    originalGroqApiKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'chave-de-teste-fake-cipa-ata-ai';

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

    // Reuniões dedicadas às regressões da revisão final (Findings 1 e 2),
    // pra não competir por estado com as reuniões acima (meetingId em
    // particular é reusado por várias its em sequência).
    const staleDraftMeetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Rascunho Obsoleto', '2026-03-12') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    staleDraftMeetingId = staleDraftMeetingResult.rows[0].id;

    const noGroqKeyMeetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Sem Chave Groq', '2026-03-13') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    noGroqKeyMeetingId = noGroqKeyMeetingResult.rows[0].id;

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
    if (originalGroqApiKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalGroqApiKey;
    }
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

  // Achado da revisão final (Finding 1 — Important): rascunho "processando"
  // órfão (ex.: sobrevivente de um restart do backend a meio do
  // processamento) não pode travar a funcionalidade pra sempre. Um rascunho
  // "processando" com updated_at de mais de 30 minutos atrás precisa deixar
  // de bloquear um novo upload — e esse novo upload precisa sobrescrever a
  // linha obsoleta por inteiro (não deixar transcript/drafts velhos por
  // engano).
  it('permite novo upload quando o rascunho "processando" existente está obsoleto (updated_at > 30min) e sobrescreve a linha', async () => {
    await (db as any).client.query(
      `INSERT INTO cipa_meeting_ata_drafts (meeting_id, tenant_id, company_unit_id, status, transcript, updated_at)
       VALUES ($1, $2, $3, 'processando', 'transcript velho de um job orfao', now() - interval '1 hour')
       ON CONFLICT (meeting_id) DO UPDATE SET
         status = 'processando', transcript = 'transcript velho de um job orfao', updated_at = now() - interval '1 hour'`,
      [staleDraftMeetingId, tenantId, companyUnitId],
    );

    fakeTranscriber.transcribe.mockResolvedValue('Transcrição nova, depois do rascunho obsoleto.');
    fakeExtractor.extract.mockResolvedValue({
      pauta: 'Pauta nova',
      discussoes: 'Discussão nova',
      deliberacoes: 'Deliberação nova',
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${staleDraftMeetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe('processando');

    const finalDraft = await waitForDraftStatus(staleDraftMeetingId, empresaToken, 'processando');
    expect(finalDraft.status).toBe('concluido');
    expect(finalDraft.transcript).toBe('Transcrição nova, depois do rascunho obsoleto.');
    expect(finalDraft.draft_pauta).toBe('Pauta nova');
  });

  // Achado da revisão final (Finding 2 — Important): sem GROQ_API_KEY
  // configurada, o endpoint precisa recusar o upload IMEDIATAMENTE com 503
  // — não aceitar o arquivo e só falhar minutos depois no pipeline em
  // segundo plano. Confirma também que nenhuma linha de rascunho chega a
  // ser criada (GET depois devolve 404, não um "falhou").
  it('sem GROQ_API_KEY configurada, recusa o upload com 503 imediatamente e não cria nenhum rascunho', async () => {
    const originalApiKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const uploadRes = await request(app.getHttpServer())
        .post(`/cipa/meetings/${noGroqKeyMeetingId}/ata-audio`)
        .set('Authorization', `Bearer ${empresaToken}`)
        .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

      expect(uploadRes.status).toBe(503);
      expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();
      expect(fakeExtractor.extract).not.toHaveBeenCalled();

      const getRes = await request(app.getHttpServer())
        .get(`/cipa/meetings/${noGroqKeyMeetingId}/ata-ai-draft`)
        .set('Authorization', `Bearer ${empresaToken}`);
      expect(getRes.status).toBe(404);
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.GROQ_API_KEY;
      } else {
        process.env.GROQ_API_KEY = originalApiKey;
      }
    }
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
