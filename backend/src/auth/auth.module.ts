import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // F-21: validateProductionEnv() (chamado em main.ts antes de
      // NestFactory.create) garante que JWT_SECRET está definido e não é
      // um valor placeholder conhecido em produção. Em dev/test, o valor
      // continua sendo lido do ambiente (sem fallback silencioso).
      secret: process.env.JWT_SECRET as string,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RegistrationService, PasswordResetService, JwtStrategy],
})
export class AuthModule {}
