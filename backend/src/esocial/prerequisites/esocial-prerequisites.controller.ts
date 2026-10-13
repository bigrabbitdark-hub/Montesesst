import { Body, Controller, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';

export class UpdateEmployeePrerequisitesDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  registrationNumber?: string;

  // Categoria do trabalhador (Tabela 01 do eSocial), 3 dígitos. Quem informa é o contador/RH.
  @IsOptional()
  @Matches(/^\d{3}$/, { message: 'esocialCategoryCode deve ter 3 dígitos' })
  esocialCategoryCode?: string;
}

// G-01: dados do vínculo que o S-2220 exige e que o Montese não inventa. O vínculo em si (S-2200/S-2190/
// S-2300) é transmitido por quem faz a folha; aqui a empresa só CONFIRMA que ele já existe no eSocial.
@Controller('esocial/employees')
export class EsocialPrerequisitesController {
  @Patch(':id/prerequisites')
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeePrerequisitesDto, @Req() req: any) {
    return req.withTenantContext(async (c: any) => {
      const r = await c.query(
        `UPDATE employees SET registration_number = COALESCE($2, registration_number),
                esocial_category_code = COALESCE($3, esocial_category_code)
          WHERE id = $1 RETURNING id, registration_number, esocial_category_code, esocial_vinculo_confirmed_at`,
        [id, dto.registrationNumber ?? null, dto.esocialCategoryCode ?? null],
      );
      if (r.rows.length === 0) throw new NotFoundException('Funcionário não encontrado');
      return r.rows[0];
    });
  }

  @Post(':id/confirm-vinculo')
  @Roles('empresa')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext(async (c: any) => {
      const r = await c.query(
        `UPDATE employees SET esocial_vinculo_confirmed_at = now(), esocial_vinculo_confirmed_by_user_id = $2
          WHERE id = $1 RETURNING id, esocial_vinculo_confirmed_at`,
        [id, req.user.id],
      );
      if (r.rows.length === 0) throw new NotFoundException('Funcionário não encontrado');
      return r.rows[0];
    });
  }
}
