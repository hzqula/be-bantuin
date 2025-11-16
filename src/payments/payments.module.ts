import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule], // Import ConfigModule untuk akses .env
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService], // Export agar bisa dipakai OrdersModule
})

export class PaymentsModule {}