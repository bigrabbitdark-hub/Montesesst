import { Body, Controller, Get, Post, Query, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { RegistrationService } from './registration.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterTechnicianDto } from './dto/register-technician.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
    private readonly passwordReset: PasswordResetService,
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

  // ITEM 022: recuperação de senha. Resposta idêntica exista a conta ou não
  // (nada de enumeração de e-mails); limite por IP+e-mail para não virar
  // ferramenta de spam na caixa de terceiros.
  @Public()
  @RateLimit({
    limit: envInt('FORGOT_PASSWORD_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip-email',
  })
  // Validação na PRÓPRIA rota (como register): sem ela, e-mail ausente ou de tipo
  // errado chegava em `rawEmail.trim()` e virava 500, e nada dependia de haver um
  // ValidationPipe global no bootstrap.
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    await this.passwordReset.request(dto.email, req.ip);
    return { message: 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.' };
  }

  @Public()
  @RateLimit({
    limit: envInt('RESET_PASSWORD_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  // Aqui a validação importa para a segurança: é ela que impõe o tamanho da senha
  // (8–72) ANTES de o token ser consumido — senha inválida não gasta o link.
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: any) {
    await this.passwordReset.reset(dto.token, dto.password, req.ip);
    return { message: 'Senha redefinida. Você já pode entrar com a nova senha.' };
  }

  // ITEM 023: novo link de confirmação para cadastro ainda pendente. Mesma resposta exista a
  // conta ou não; o intervalo entre reenvios para o mesmo e-mail é imposto no serviço.
  @Public()
  @RateLimit({
    limit: envInt('RESEND_CONFIRMATION_RATE_LIMIT_MAX', 3),
    windowSeconds: envInt('RESEND_CONFIRMATION_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip-email',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('resend-confirmation')
  async resendConfirmation(@Body() dto: ResendConfirmationDto, @Req() req: any) {
    await this.registrationService.resendConfirmation(dto.email, req.ip);
    return { message: 'Se houver um cadastro pendente para este e-mail, enviamos um novo link de confirmação.' };
  }

  @Public()
  @RateLimit({
    limit: envInt('AUTH_CONFIRM_RATE_LIMIT_MAX', 30),
    windowSeconds: envInt('AUTH_CONFIRM_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @Get('confirm')
  async confirm(@Query('token') token: string, @Req() req: any, @Res() res: Response) {
    const status = await this.registrationService.confirm(token, req.ip);
    res.redirect(302, `/cadastro/confirmado?status=${status}`);
  }

  // ITEM 002 (auditoria 2026-09-27): "quem estou logado" precisa continuar
  // respondendo mesmo com assinatura inativa, senão o frontend não tem como
  // saber quem é o usuário pra mostrar a tela de "reative seu plano".
  @SkipSubscriptionCheck()
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
