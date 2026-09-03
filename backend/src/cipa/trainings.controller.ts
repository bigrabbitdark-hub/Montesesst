import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { TrainingsService, TrainingType } from './trainings.service';
import { CreateTrainingDto } from './dto/create-training.dto';

@Controller('cipa/trainings')
export class TrainingsController {
  constructor(private readonly trainings: TrainingsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('certificado', { limits: { fileSize: 10 * 1024 * 1024 } }))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateTrainingDto,
    @Req() req: any,
  ) {
    // Mesma checagem manual de "exatamente um / exatamente nenhum"
    // já usada em MeetingsController.setParticipants e
    // ElectionsController.addCandidate, adaptada pro par
    // tipo='outro'/tipo_outro (aqui não é "um dos dois", é "tipo_outro
    // só existe quando tipo é 'outro'").
    if (dto.tipo === 'outro' && !dto.tipo_outro) {
      throw new BadRequestException('tipo_outro é obrigatório quando tipo = "outro"');
    }
    if (dto.tipo !== 'outro' && dto.tipo_outro) {
      throw new BadRequestException('tipo_outro só pode ser enviado quando tipo = "outro"');
    }
    return req.withTenantContext((client: any) =>
      this.trainings.create(client, req.user.tenantId, req.user.id, {
        employeeId: dto.employee_id,
        tipo: dto.tipo as TrainingType,
        tipoOutro: dto.tipo_outro,
        dataRealizacao: dto.data_realizacao,
        dataValidade: dto.data_validade,
        cargaHoraria: dto.carga_horaria,
        file: file
          ? { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size }
          : undefined,
      }),
    );
  }

  @Get()
  findAll(
    @Query('employee_id') employeeId: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.trainings.findAll(client, { employeeId, tipo, status }));
  }

  @Roles('empresa')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.trainings.remove(client, id));
  }
}
