import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Orders Module
 * 
 * Modul ini adalah jantung dari marketplace Bantuin.
 * Menangani seluruh lifecycle transaksi dari pemesanan hingga penyelesaian:
 * 
 * 1. Order Creation - Buyer membuat pesanan untuk service
 * 2. Payment Processing - Integrasi dengan payment gateway (Midtrans/Xendit)
 * 3. Escrow Management - Dana ditahan sampai pekerjaan selesai
 * 4. Work Delivery - Seller mengirimkan hasil kerja
 * 5. Revision Management - Handling permintaan revisi dari buyer
 * 6. Order Completion - Pelepasan escrow dan finalisasi transaksi
 * 7. Cancellation & Disputes - Handling pembatalan dan sengketa
 * 
 * Fitur keamanan yang diimplementasikan:
 * - State machine validation untuk mencegah status transitions yang invalid
 * - Access control: hanya buyer/seller terkait yang bisa akses order
 * - Idempotency untuk payment callbacks
 * - Transaction atomicity untuk operasi kritis
 * - Audit trail untuk semua perubahan status
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService], // Export untuk digunakan di modules lain (Reviews, Disputes)
})
export class OrdersModule {}