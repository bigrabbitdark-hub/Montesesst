import { Controller, Delete, Get, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DatabaseService } from '../common/database/database.service';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly googleCalendar: GoogleCalendarService,
    private readonly db: DatabaseService,
  ) {}

  @Roles('tecnico')
  @Get('auth-url')
  authUrl(@Req() req: any) {
    return { url: this.googleCalendar.getAuthUrl(req.user.id) };
  }

  // Rota pública: é chamada por navegação de browser vindo do redirect
  // do próprio Google, sem Authorization header — não existe req.user
  // nem req.withTenantContext funcional aqui (o interceptor monta esse
  // helper a partir de req.user, que está ausente numa request pública).
  // Por isso injeta DatabaseService diretamente e chama
  // withTenantContext({ role: 'admin' }, ...) na mão — mesmo padrão exato
  // já usado em visit-reminder.cron.ts pra rodar contra tabelas com RLS
  // sem um usuário autenticado de verdade. O `state` assinado (verificado
  // dentro de handleCallback) é a prova de identidade nesta rota.
  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      await this.db.withTenantContext({ role: 'admin' }, (client) =>
        this.googleCalendar.handleCallback(client, code, state),
      );
      res.redirect('/tecnico/configuracoes?google=conectado');
    } catch {
      res.redirect('/tecnico/configuracoes?google=erro');
    }
  }

  @Roles('tecnico')
  @Get('status')
  status(@Req() req: any) {
    return req.withTenantContext((client: any) => this.googleCalendar.getStatus(client, req.user.id));
  }

  @Roles('tecnico')
  @Delete('desconectar')
  disconnect(@Req() req: any) {
    return req.withTenantContext((client: any) => this.googleCalendar.disconnect(client, req.user.id));
  }
}
