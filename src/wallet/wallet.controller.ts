import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type {
  CreateWithdrawalDto,
  ProcessWithdrawalDto,
  CancelWithdrawalDto,
  WalletTransactionFilterDto,
} from './dto/wallet.dto';

/**
 * WalletController
 * 
 * Controller ini menangani semua endpoints untuk wallet operations.
 * Sebagian besar endpoints memerlukan authentication dan beberapa
 * memerlukan role khusus (admin).
 * 
 * Endpoints:
 * - GET /wallet/summary - Dashboard wallet user
 * - GET /wallet/transactions - Transaction history
 * - POST /wallet/withdraw - Create withdrawal request
 * - POST /wallet/withdraw/:id/cancel - Cancel withdrawal
 * - POST /wallet/withdraw/:id/process - Process withdrawal (admin)
 * - GET /wallet/withdrawals - List all withdrawals
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get wallet summary
   * GET /api/wallet/summary
   * 
   * Endpoint ini return comprehensive overview dari wallet user:
   * - Current balance (available)
   * - Pending balance (dalam escrow)
   * - Total earnings dan withdrawals
   * - Recent transactions
   * - Pending withdrawal requests
   * 
   * Ini adalah data yang ditampilkan di dashboard seller.
   * 
   * Requires: Authentication
   * Response: { success, data: WalletSummary }
   */
  @Get('summary')
  async getSummary(@GetUser('id') userId: string) {
    const summary = await this.walletService.getWalletSummary(userId);

    return {
      success: true,
      data: summary,
    };
  }

  /**
   * Get transaction history
   * GET /api/wallet/transactions
   * 
   * User bisa lihat semua transaksi wallet mereka dengan filtering.
   * Support pagination, filtering by type, date range, dan order ID.
   * 
   * Query params:
   * - type?: TransactionType
   * - startDate?: ISO datetime
   * - endDate?: ISO datetime
   * - orderId?: UUID
   * - page?: number (default: 1)
   * - limit?: number (default: 20, max: 100)
   * - sortBy?: 'newest' | 'oldest' | 'amount_high' | 'amount_low'
   * 
   * Requires: Authentication
   * Response: { success, data: Transaction[], pagination }
   */
  @Get('transactions')
  async getTransactions(
    @GetUser('id') userId: string,
    @Query() filters: WalletTransactionFilterDto
  ) {
    const result = await this.walletService.getTransactionHistory(
      userId,
      filters
    );

    return {
      success: true,
      data: result.data,
      pagination: result.pagination,
    };
  }

  /**
   * Create withdrawal request
   * POST /api/wallet/withdraw
   * 
   * Seller request untuk withdraw dana dari wallet ke rekening bank.
   * 
   * Validations:
   * - Balance sufficient
   * - Amount within limits (min: 50K, max: 10M)
   * - Not exceeding max pending withdrawals (3)
   * - Bank account details valid
   * 
   * Flow setelah create:
   * 1. Dana di-hold (dikurangi dari available balance)
   * 2. Withdrawal request masuk queue untuk admin review
   * 3. Admin approve/reject dalam 1-3 hari kerja
   * 4. Jika approved, dana ditransfer ke rekening
   * 5. Jika rejected/failed, dana dikembalikan ke wallet
   * 
   * Requires: Authentication
   * Body: CreateWithdrawalDto
   * Response: { success, message, data: { withdrawalId, amount, ... } }
   */
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  async createWithdrawal(
    @GetUser('id') userId: string,
    @Body() dto: CreateWithdrawalDto
  ) {
    const result = await this.walletService.createWithdrawal(userId, dto);
    return result;
  }

  /**
   * Cancel withdrawal request
   * POST /api/wallet/withdraw/:id/cancel
   * 
   * Seller bisa cancel withdrawal request mereka sendiri
   * selama masih dalam status PENDING.
   * 
   * Setelah cancel:
   * - Status berubah ke CANCELLED
   * - Dana yang di-hold dikembalikan ke available balance
   * - Transaction reversal dicatat untuk audit trail
   * 
   * Requires: Authentication dan ownership
   * Params: id (withdrawal ID)
   * Body: { reason?: string }
   * Response: { success, message }
   */
  @Post('withdraw/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelWithdrawal(
    @Param('id') withdrawalId: string,
    @GetUser('id') userId: string,
    @Body() dto: CancelWithdrawalDto
  ) {
    const result = await this.walletService.cancelWithdrawal(userId, {
      ...dto,
      withdrawalId,
    });

    return result;
  }

  /**
   * Process withdrawal (admin only)
   * POST /api/wallet/withdraw/:id/process
   * 
   * Admin menggunakan endpoint ini untuk:
   * - Approve: Mulai proses transfer
   * - Reject: Tolak request dengan alasan
   * - Complete: Mark sebagai selesai setelah transfer sukses
   * - Fail: Mark sebagai gagal jika transfer failed
   * 
   * Actions dan consequences:
   * 
   * APPROVE (pending → processing):
   * - No balance change (sudah di-hold)
   * - Admin bisa mulai proses transfer
   * 
   * REJECT (pending → cancelled):
   * - Dana dikembalikan ke balance
   * - Admin notes wajib (explain rejection)
   * 
   * COMPLETE (processing → completed):
   * - No balance change
   * - Withdrawal selesai, dana sudah di rekening seller
   * 
   * FAIL (processing → failed):
   * - Dana dikembalikan ke balance
   * - Admin notes wajib (explain failure)
   * 
   * TODO: Implement proper admin authorization
   * Untuk sekarang, endpoint ini bisa dipanggil oleh authenticated user.
   * Di production, harus cek role admin.
   * 
   * Requires: Authentication + Admin role (TODO)
   * Params: id (withdrawal ID)
   * Body: ProcessWithdrawalDto
   * Response: { success, message }
   */
  @Post('withdraw/:id/process')
  @HttpCode(HttpStatus.OK)
  async processWithdrawal(
    @Param('id') withdrawalId: string,
    @GetUser('id') adminId: string,
    @Body() dto: ProcessWithdrawalDto
  ) {
    // TODO: Add admin role check
    // if (!user.isAdmin) throw new ForbiddenException();

    const result = await this.walletService.processWithdrawal(
      { ...dto, withdrawalId },
      adminId
    );

    return result;
  }

  /**
   * Get all withdrawals (with filtering)
   * GET /api/wallet/withdrawals
   * 
   * User bisa lihat semua withdrawal requests mereka.
   * Admin bisa lihat semua withdrawals (TODO: implement admin view).
   * 
   * Query params:
   * - status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
   * - page?: number
   * - limit?: number
   * 
   * Requires: Authentication
   * Response: { success, data: Withdrawal[], pagination }
   */
  @Get('withdrawals')
  async getWithdrawals(
    @GetUser('id') userId: string,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10
  ) {
    // Build where clause
    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    // Get withdrawals with pagination
    const skip = (page - 1) * limit;

    const [withdrawals, total] = await Promise.all([
      this.walletService['prisma'].withdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.walletService['prisma'].withdrawal.count({ where }),
    ]);

    return {
      success: true,
      data: withdrawals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single withdrawal detail
   * GET /api/wallet/withdrawals/:id
   * 
   * Get detail lengkap dari withdrawal request.
   * Include transaction history related to withdrawal ini.
   * 
   * Requires: Authentication dan ownership
   * Params: id (withdrawal ID)
   * Response: { success, data: Withdrawal }
   */
  @Get('withdrawals/:id')
  async getWithdrawalDetail(
    @Param('id') withdrawalId: string,
    @GetUser('id') userId: string
  ) {
    const withdrawal = await this.walletService['prisma'].withdrawal.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
      include: {
        wallet: {
          select: {
            id: true,
            balance: true,
          },
        },
      },
    });

    if (!withdrawal) {
      return {
        success: false,
        message: 'Withdrawal tidak ditemukan',
      };
    }

    // Get related transactions
    const transactions = await this.walletService['prisma'].walletTransaction.findMany({
      where: {
        refWithdrawalId: withdrawalId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      data: {
        ...withdrawal,
        transactions,
      },
    };
  }

  /**
   * Health check untuk wallet service
   * GET /api/wallet/health
   * 
   * Untuk monitoring apakah wallet service running properly.
   * 
   * Public endpoint (no auth required)
   * Response: { status, timestamp }
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'wallet',
    };
  }
}