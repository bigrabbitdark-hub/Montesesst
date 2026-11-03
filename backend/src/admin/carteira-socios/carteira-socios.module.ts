import { Module } from '@nestjs/common';
import { CarteiraSociosController } from './carteira-socios.controller';
import { CarteiraSociosService } from './carteira-socios.service';

@Module({ controllers: [CarteiraSociosController], providers: [CarteiraSociosService] })
export class CarteiraSociosModule {}
