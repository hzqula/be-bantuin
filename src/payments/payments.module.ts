import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * PaymentsModule
 * 
 * Module ini adalah implementation lengkap dari payment system
 * dengan escrow untuk Marketplace Bantuin.
 * 
 * Fitur utama:
 * 1. Payment Gateway Integration (Midtrans)
 *    - Support multiple payment methods (bank transfer, e-wallet, dll)
 *    - Snap interface untuk user-friendly payment experience
 *    - Webhook handling untuk real-time payment notifications
 * 
 * 2. Escrow System
 *    - Dana buyer ditahan sampai pekerjaan selesai
 *    - Automatic release setelah buyer approve hasil
 *    - Refund mechanism untuk disputes
 * 
 * 3. Security Features
 *    - Signature validation untuk webhooks
 *    - Idempotency untuk prevent duplicate transactions
 *    - Access control untuk sensitive operations
 * 
 * 4. Wallet Management
 *    - Track escrow holds dan releases
 *    - Platform fee calculation dan recording
 *    - Transaction history untuk audit trail
 * 
 * Dependencies:
 * - PrismaModule: Database access
 * - ConfigModule: Environment variables (Midtrans credentials)
 * 
 * Environment Variables Required:
 * - MIDTRANS_SERVER_KEY: Server key dari Midtrans dashboard
 * - MIDTRANS_CLIENT_KEY: Client key dari Midtrans dashboard
 * - NODE_ENV: 'production' untuk production API, lainnya untuk sandbox
 * - FRONTEND_URL: URL frontend untuk payment callbacks
 */
@Module({
  imports: [
    PrismaModule,
    ConfigModule, // Needed untuk access environment variables
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService], // Export untuk digunakan di OrdersModule
})
export class PaymentsModule {}