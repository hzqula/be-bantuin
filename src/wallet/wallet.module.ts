import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * WalletModule
 * 
 * Module ini implements complete digital wallet system untuk sellers
 * di Marketplace Bantuin. Wallet berfungsi sebagai jembatan antara
 * escrow system dengan real-world banking.
 * 
 * Core Features:
 * 
 * 1. Balance Management
 *    - Track available balance (bisa di-withdraw)
 *    - Track pending balance (dalam escrow)
 *    - Real-time balance updates dari escrow releases
 * 
 * 2. Transaction History
 *    - Complete audit trail untuk semua transaksi
 *    - Double-entry bookkeeping untuk accuracy
 *    - Filtering dan pagination untuk easy navigation
 * 
 * 3. Withdrawal System
 *    - Seller request withdrawals ke rekening bank
 *    - Admin review dan approval process
 *    - Multiple status tracking (pending → processing → completed)
 *    - Automatic reversal untuk failed/cancelled withdrawals
 * 
 * 4. Security & Compliance
 *    - Balance holds selama withdrawal processing
 *    - Idempotent operations untuk prevent duplicates
 *    - Complete audit trail untuk regulatory compliance
 *    - Admin controls untuk fraud prevention
 * 
 * Design Decisions:
 * 
 * - Manual approval required: Untuk security dan fraud prevention,
 *   semua withdrawals require admin approval. Di future, bisa
 *   implement auto-approval untuk trusted sellers.
 * 
 * - Balance holds: Dana di-hold saat withdrawal requested, bukan
 *   saat approved. Ini prevent race conditions dan ensure funds
 *   availability.
 * 
 * - Withdrawal fees: Platform bisa take fixed atau percentage fee
 *   untuk cover transaction costs. Currently set minimal (5K fixed).
 * 
 * - Minimum balance: Prevent balance going negative. Currently 0,
 *   tapi bisa diset higher untuk stability.
 * 
 * Integration Points:
 * - PaymentsModule: Escrow releases credit wallet balance
 * - OrdersModule: Order completion triggers escrow release
 * - AdminModule: Admin dashboard untuk manage withdrawals
 * 
 * Future Enhancements:
 * - Integration dengan disbursement API (Flip, Xendit)
 * - Batch withdrawal processing untuk efficiency
 * - Auto-approval untuk verified sellers
 * - Wallet top-up feature untuk buyers
 * - Multi-currency support
 */
@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService], // Export untuk digunakan di PaymentsModule
})
export class WalletModule {}