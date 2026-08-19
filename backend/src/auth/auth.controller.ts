import { Body, Controller, Get, Post, Query, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterTechnicianDto } from './dto/register-technician.dto';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
  ) {}

  @Public()
  @RateLimit({
    limit: envInt('AUTH_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('AUTH_RATE_LIMIT_WINDOW_SECONDS', 900),
    keyBy: 'ip-email',
  })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto.email, dto.password, req.ip);
  }

  @Public()
  @RateLimit({
    limit: envInt('REGISTER_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    await this.registrationService.register({
      companyName: dto.company_name,
      cnpj: dto.cnpj,
      fullName: dto.full_name,
      email: dto.email,
      password: dto.password,
      ip: req.ip,
    });
    return { message: 'Cadastro recebido — verifique seu e-mail para confirmar.' };
  }

  @Public()
  @RateLimit({
    limit: envInt('REGISTER_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('register-technician')
  async registerTechnician(@Body() dto: RegisterTechnicianDto, @Req() req: any) {
    await this.registrationService.registerTechnician({
      email: dto.email,
      password: dto.password,
      fullName: dto.full_name,
      phone: dto.phone,
      registrationNumber: dto.registration_number,
      specialization: dto.specialization,
      ip: req.ip,
    });
    return { message: 'Cadastro recebido — verifique seu e-mail para confirmar.' };
  }

  @Public()
  @Get('confirm')
  async confirm(@Query('token') token: string, @Res() res: Response) {
    const status = await this.registrationService.confirm(token);
    res.redirect(302, `/cadastro/confirmado?status=${status}`);
  }

  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
