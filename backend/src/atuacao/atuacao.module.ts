import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { InteracoesController } from './interacoes.controller';
import { InteracoesService } from './interacoes.service';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { AtuacaoController } from './atuacao.controller';
import { AtuacaoService } from './atuacao.service';
import { ResponsaveisController } from './responsaveis.controller';
import { TarefasController } from './tarefas.controller';
import { TarefasService } from './tarefas.service';
import { DocumentosController } from './documentos/documentos.controller';
import { DocumentosService } from './documentos/documentos.service';
import { DocumentosAdminController } from './documentos/documentos-admin.controller';
import { DocumentosAdminService } from './documentos/documentos-admin.service';
import { PermissoesAdminController } from './permissoes/permissoes-admin.controller';
import { PermissoesAdminService } from './permissoes/permissoes-admin.service';

@Module({ controllers: [AtuacaoController, TarefasController, ResponsaveisController, AgendaController, InteracoesController, FinanceiroController, DocumentosController, DocumentosAdminController, PermissoesAdminController], providers: [PermissoesAdminService, DocumentosAdminService, DocumentosService, FinanceiroService, AtuacaoService, TarefasService, AgendaService, InteracoesService] })
export class AtuacaoModule {}
