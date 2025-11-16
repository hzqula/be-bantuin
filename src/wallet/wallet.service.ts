import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateWithdrawalDto,
  ProcessWithdrawalDto,
  CancelWithdrawalDto,
  WalletTransactionFilterDto,
  ManualAdjustmentDto,
} from './dto/wallet.dto';
import type {
  WalletSummary,
  CreateWithdrawalResponse,
  WalletTransactionRecord,
} from './type/wallet.type';
import {
  WALLET_CONSTANTS,
  calculateNetWithdrawalAmount,
  formatCurrency,
} from './type/wallet.type';
import { Prisma } from '@prisma/client';

/**
 * WalletService
 * 
 * Service ini menangani semua operasi wallet:
 * 1. Balance management dan tracking
 * 2. Transaction history recording
 * 3. Withdrawal request creation dan processing
 * 4. Wallet summary dan analytics
 * 
 * Design principles:
 * - Double-entry bookkeeping: Setiap transaction tercatat dengan balance before/after
 * - Atomic operations: Semua balance updates dalam database transaction
 * - Audit trail: Lengkap untuk compliance dan debugging
 * - Security: Access control dan validation ketat
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get atau create wallet untuk user
   * 
   * Setiap seller otomatis punya wallet.
   * Method ini idempotent - kalau wallet sudah ada, return existing.
   */
  async getOrCreateWallet(userId: string): Promise<{
    id: string;
    userId: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: {
        userId,
        balance: 0,
      },
      update: {},
    });

    return wallet;
  }

  /**
   * Get wallet summary untuk dashboard
   * 
   * Menggabungkan data dari wallet, transactions, dan withdrawals
   * untuk memberikan overview lengkap ke user.
   */
  async getWalletSummary(userId: string): Promise<WalletSummary> {
    // Ensure wallet exists
    const wallet = await this.getOrCreateWallet(userId);

    // Calculate pending balance (escrow holds yang belum released)
    const pendingBalance = await this.calculatePendingBalance(wallet.id);

    // Calculate available for withdrawal
    // Available = balance - minimum balance requirement
    const availableForWithdrawal = Math.max(
      0,
      wallet.balance - WALLET_CONSTANTS.MIN_BALANCE
    );

    // Get earnings dan withdrawals this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const [thisMonthEarnings, thisMonthWithdrawn] = await Promise.all([
      this.calculateEarningsInPeriod(wallet.id, startOfMonth, now),
      this.calculateWithdrawalsInPeriod(wallet.id, startOfMonth, now),
    ]);

    // Get total earnings dan withdrawals (all time)
    const [totalEarnings, totalWithdrawn] = await Promise.all([
      this.calculateTotalEarnings(wallet.id),
      this.calculateTotalWithdrawn(wallet.id),
    ]);

    // Get pending withdrawals
    const pendingWithdrawalRequests = await this.prisma.withdrawal.findMany({
      where: {
        userId,
        status: 'pending',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const pendingWithdrawals = pendingWithdrawalRequests.reduce(
      (sum, w) => sum + Number(w.amount),
      0
    );

    // Get recent transactions (last 10)
    const recentTransactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      balance: wallet.balance,
      pendingBalance,
      availableForWithdrawal,
      totalEarnings,
      totalWithdrawn,
      thisMonthEarnings,
      thisMonthWithdrawn,
      pendingWithdrawals,
      recentTransactions: recentTransactions as WalletTransactionRecord[],
      pendingWithdrawalRequests: pendingWithdrawalRequests as any[],
    };
  }

  /**
   * Create withdrawal request
   * 
   * Seller request untuk withdraw dana dari wallet ke rekening bank.
   * Dana akan di-hold (dikurangi dari available balance) sambil
   * menunggu admin process.
   */
  async createWithdrawal(
    userId: string,
    dto: CreateWithdrawalDto
  ): Promise<CreateWithdrawalResponse> {
    // Get wallet dengan lock untuk prevent race condition
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet tidak ditemukan');
    }

    // Check available balance
    const availableBalance = wallet.balance - WALLET_CONSTANTS.MIN_BALANCE;
    if (availableBalance < dto.amount) {
      throw new BadRequestException(
        `Balance tidak mencukupi. Available: ${formatCurrency(availableBalance)}, ` +
        `Requested: ${formatCurrency(dto.amount)}`
      );
    }

    // Check pending withdrawals limit
    const pendingCount = await this.prisma.withdrawal.count({
      where: {
        userId,
        status: 'pending',
      },
    });

    if (pendingCount >= WALLET_CONSTANTS.MAX_PENDING_WITHDRAWALS) {
      throw new BadRequestException(
        `Anda sudah memiliki ${pendingCount} withdrawal yang pending. ` +
        `Maksimal ${WALLET_CONSTANTS.MAX_PENDING_WITHDRAWALS} withdrawal pending.`
      );
    }

    // Calculate fee dan net amount
    const { gross, fee, net } = calculateNetWithdrawalAmount(dto.amount);

    this.logger.log(
      `Creating withdrawal for user ${userId}. ` +
      `Gross: ${gross}, Fee: ${fee}, Net: ${net}`
    );

    // Create withdrawal request dan hold balance
    const result = await this.prisma.$transaction(async (tx) => {
      // Create withdrawal record
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          walletId: wallet.id,
          amount: dto.amount,
          fee,
          netAmount: net,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          accountHolderName: dto.accountHolderName,
          status: 'pending',
          notes: dto.notes,
        },
      });

      // Hold balance (subtract from wallet)
      // Dana akan dikembalikan jika withdrawal cancelled/failed
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            decrement: dto.amount,
          },
        },
      });

      // Record transaction
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: -dto.amount, // Negative karena keluar dari wallet
          refWithdrawalId: withdrawal.id,
          description: `Withdrawal ke ${dto.bankCode} ${dto.accountNumber}`,
          metadata: {
            withdrawalId: withdrawal.id,
            bankCode: dto.bankCode,
            accountNumber: dto.accountNumber,
            accountHolderName: dto.accountHolderName,
            gross,
            fee,
            net,
          },
        },
      });

      return withdrawal;
    });

    this.logger.log(`Withdrawal ${result.id} created successfully`);

    // TODO: Send notification ke admin untuk review withdrawal
    // TODO: Send confirmation ke seller

    return {
      success: true,
      message: 'Withdrawal request berhasil dibuat. Tim kami akan memproses dalam 1-3 hari kerja.',
      data: {
        withdrawalId: result.id,
        amount: dto.amount,
        estimatedArrival: `${WALLET_CONSTANTS.PROCESSING_TIME_DAYS.MIN}-${WALLET_CONSTANTS.PROCESSING_TIME_DAYS.MAX} hari kerja`,
        newBalance: wallet.balance - dto.amount,
      },
    };
  }

  /**
   * Process withdrawal (admin only)
   * 
   * Admin bisa approve, reject, complete, atau mark as failed.
   * Setiap action punya consequences yang berbeda terhadap balance.
   */
  async processWithdrawal(
    dto: ProcessWithdrawalDto,
    adminId: string
  ): Promise<{ success: boolean; message: string }> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: dto.withdrawalId },
      include: { wallet: true },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request tidak ditemukan');
    }

    const { action, adminNotes, proofOfTransfer } = dto;

    this.logger.log(
      `Processing withdrawal ${withdrawal.id}. ` +
      `Action: ${action}, Admin: ${adminId}`
    );

    switch (action) {
      case 'approve':
        return await this.approveWithdrawal(withdrawal, adminId, adminNotes);
      
      case 'reject':
        return await this.rejectWithdrawal(withdrawal, adminId, adminNotes);
      
      case 'complete':
        return await this.completeWithdrawal(
          withdrawal,
          adminId,
          adminNotes,
          proofOfTransfer
        );
      
      case 'fail':
        return await this.failWithdrawal(withdrawal, adminId, adminNotes);
      
      default:
        throw new BadRequestException('Invalid action');
    }
  }

  /**
   * Approve withdrawal
   * 
   * Admin approve dan mulai proses transfer ke bank.
   * Status berubah dari PENDING ke PROCESSING.
   * Balance sudah di-hold saat create, jadi tidak ada perubahan balance.
   */
  private async approveWithdrawal(
    withdrawal: any,
    adminId: string,
    adminNotes?: string
  ): Promise<{ success: boolean; message: string }> {
    if (withdrawal.status !== 'pending') {
      throw new BadRequestException(
        `Withdrawal dengan status ${withdrawal.status} tidak bisa di-approve`
      );
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'processing',
        processedBy: adminId,
        processedAt: new Date(),
        adminNotes: adminNotes || 'Withdrawal disetujui dan sedang diproses',
      },
    });

    this.logger.log(`Withdrawal ${withdrawal.id} approved by admin ${adminId}`);

    // TODO: Trigger actual bank transfer process
    // Bisa melalui:
    // - Manual transfer oleh admin
    // - Integration dengan disbursement API (Flip, Xendit, dll)
    // - Batch processing untuk efficiency

    // TODO: Send notification ke seller

    return {
      success: true,
      message: 'Withdrawal berhasil diapprove. Transfer sedang diproses.',
    };
  }

  /**
   * Reject withdrawal
   * 
   * Admin reject withdrawal request.
   * Dana yang sudah di-hold dikembalikan ke balance.
   */
  private async rejectWithdrawal(
    withdrawal: any,
    adminId: string,
    adminNotes?: string
  ): Promise<{ success: boolean; message: string }> {
    if (withdrawal.status !== 'pending') {
      throw new BadRequestException(
        `Withdrawal dengan status ${withdrawal.status} tidak bisa di-reject`
      );
    }

    if (!adminNotes) {
      throw new BadRequestException(
        'Admin notes wajib diisi untuk rejection'
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Update withdrawal status
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'cancelled',
          processedBy: adminId,
          processedAt: new Date(),
          adminNotes,
        },
      });

      // Return balance (reversal)
      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: {
          balance: {
            increment: Number(withdrawal.amount),
          },
        },
      });

      // Record reversal transaction
      await tx.walletTransaction.create({
        data: {
          walletId: withdrawal.walletId,
          type: 'WITHDRAWAL_REVERSAL',
          amount: Number(withdrawal.amount), // Positive karena dikembalikan
          refWithdrawalId: withdrawal.id,
          description: `Withdrawal dibatalkan - dana dikembalikan`,
          metadata: {
            withdrawalId: withdrawal.id,
            reason: adminNotes,
            rejectedBy: adminId,
          },
        },
      });
    });

    this.logger.log(`Withdrawal ${withdrawal.id} rejected by admin ${adminId}`);

    // TODO: Send notification ke seller dengan alasan rejection

    return {
      success: true,
      message: 'Withdrawal berhasil di-reject. Dana dikembalikan ke wallet.',
    };
  }

  /**
   * Complete withdrawal
   * 
   * Admin mark withdrawal sebagai completed setelah transfer sukses.
   * Balance tidak berubah karena sudah di-hold sebelumnya.
   */
  private async completeWithdrawal(
    withdrawal: any,
    adminId: string,
    adminNotes?: string,
    proofOfTransfer?: string
  ): Promise<{ success: boolean; message: string }> {
    if (withdrawal.status !== 'processing') {
      throw new BadRequestException(
        `Withdrawal dengan status ${withdrawal.status} tidak bisa di-complete`
      );
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        adminNotes: adminNotes || 'Transfer berhasil',
        metadata: {
          ...(withdrawal.metadata || {}),
          proofOfTransfer,
          completedBy: adminId,
        },
      },
    });

    this.logger.log(`Withdrawal ${withdrawal.id} completed by admin ${adminId}`);

    // TODO: Send notification ke seller bahwa dana sudah masuk

    return {
      success: true,
      message: 'Withdrawal berhasil di-mark sebagai completed.',
    };
  }

  /**
   * Fail withdrawal
   * 
   * Admin mark withdrawal sebagai failed (transfer gagal).
   * Dana dikembalikan ke balance seperti rejection.
   */
  private async failWithdrawal(
    withdrawal: any,
    adminId: string,
    adminNotes?: string
  ): Promise<{ success: boolean; message: string }> {
    if (withdrawal.status !== 'processing') {
      throw new BadRequestException(
        `Withdrawal dengan status ${withdrawal.status} tidak bisa di-fail`
      );
    }

    if (!adminNotes) {
      throw new BadRequestException(
        'Admin notes wajib diisi untuk failure'
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Update withdrawal status
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'failed',
          processedAt: new Date(),
          adminNotes,
        },
      });

      // Return balance
      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: {
          balance: {
            increment: Number(withdrawal.amount),
          },
        },
      });

      // Record reversal transaction
      await tx.walletTransaction.create({
        data: {
          walletId: withdrawal.walletId,
          type: 'WITHDRAWAL_REVERSAL',
          amount: Number(withdrawal.amount),
          refWithdrawalId: withdrawal.id,
          description: `Withdrawal gagal - dana dikembalikan`,
          metadata: {
            withdrawalId: withdrawal.id,
            reason: adminNotes,
            failedBy: adminId,
          },
        },
      });
    });

    this.logger.log(`Withdrawal ${withdrawal.id} failed by admin ${adminId}`);

    // TODO: Send notification ke seller dengan alasan failure

    return {
      success: true,
      message: 'Withdrawal di-mark sebagai failed. Dana dikembalikan ke wallet.',
    };
  }

  /**
   * Cancel withdrawal (by user)
   * 
   * Seller bisa cancel withdrawal mereka sendiri selama masih pending.
   */
  async cancelWithdrawal(
    userId: string,
    dto: CancelWithdrawalDto
  ): Promise<{ success: boolean; message: string }> {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: {
        id: dto.withdrawalId,
        userId,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request tidak ditemukan');
    }

    if (withdrawal.status !== 'pending') {
      throw new BadRequestException(
        `Withdrawal dengan status ${withdrawal.status} tidak bisa di-cancel. ` +
        `Hanya withdrawal pending yang bisa di-cancel.`
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Update withdrawal status
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'cancelled',
          adminNotes: dto.reason || 'Dibatalkan oleh user',
        },
      });

      // Return balance
      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: {
          balance: {
            increment: Number(withdrawal.amount),
          },
        },
      });

      // Record reversal transaction
      await tx.walletTransaction.create({
        data: {
          walletId: withdrawal.walletId,
          type: 'WITHDRAWAL_REVERSAL',
          amount: Number(withdrawal.amount),
          refWithdrawalId: withdrawal.id,
          description: `Withdrawal dibatalkan oleh user`,
          metadata: {
            withdrawalId: withdrawal.id,
            reason: dto.reason,
          },
        },
      });
    });

    this.logger.log(`Withdrawal ${withdrawal.id} cancelled by user ${userId}`);

    return {
      success: true,
      message: 'Withdrawal berhasil dibatalkan. Dana dikembalikan ke wallet.',
    };
  }

  /**
   * Get transaction history
   * 
   * User bisa lihat semua transaksi wallet mereka dengan filtering.
   */
  async getTransactionHistory(
    userId: string,
    filters: WalletTransactionFilterDto
  ): Promise<{
    data: WalletTransactionRecord[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    // Get user's wallet
    const wallet = await this.getOrCreateWallet(userId);

    // Build where clause
    const where: Prisma.WalletTransactionWhereInput = {
      walletId: wallet.id,
    };

    // Filter by type
    if (filters.type) {
      where.type = filters.type;
    }

    // Filter by date range
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    // Filter by order
    if (filters.orderId) {
      where.refOrderId = filters.orderId;
    }

    // Build order by
    let orderBy: Prisma.WalletTransactionOrderByWithRelationInput = {};
    switch (filters.sortBy) {
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'amount_high':
        orderBy = { amount: 'desc' };
        break;
      case 'amount_low':
        orderBy = { amount: 'asc' };
        break;
    }

    // Pagination
    const skip = (filters.page - 1) * filters.limit;

    // Execute queries
    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy,
        skip,
        take: filters.limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      data: transactions as WalletTransactionRecord[],
      pagination: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Helper: Calculate pending balance (escrow holds)
   */
  private async calculatePendingBalance(walletId: string): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: {
        walletId,
        type: 'ESCROW_HOLD',
        // Only count holds that haven't been released yet
        refOrderId: {
          in: await this.prisma.order
            .findMany({
              where: {
                status: { in: ['paid_escrow', 'in_progress', 'delivered', 'revision'] },
              },
              select: { id: true },
            })
            .then((orders) => orders.map((o) => o.id)),
        },
      },
      _sum: {
        amount: true,
      },
    });

    // Sum will be negative (holds), so convert to positive
    return Math.abs(Number(result._sum.amount) || 0);
  }

  /**
   * Helper: Calculate earnings in period
   */
  private async calculateEarningsInPeriod(
    walletId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: {
        walletId,
        type: 'ESCROW_RELEASE',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        amount: true,
      },
    });

    return Number(result._sum.amount) || 0;
  }

  /**
   * Helper: Calculate withdrawals in period
   */
  private async calculateWithdrawalsInPeriod(
    walletId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: {
        walletId,
        type: 'WITHDRAWAL',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        amount: true,
      },
    });

    // Sum will be negative (withdrawals), so convert to positive
    return Math.abs(Number(result._sum.amount) || 0);
  }

  /**
   * Helper: Calculate total earnings (all time)
   */
  private async calculateTotalEarnings(walletId: string): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: {
        walletId,
        type: 'ESCROW_RELEASE',
      },
      _sum: {
        amount: true,
      },
    });

    return Number(result._sum.amount) || 0;
  }

  /**
   * Helper: Calculate total withdrawn (all time)
   */
  private async calculateTotalWithdrawn(walletId: string): Promise<number> {
    const result = await this.prisma.withdrawal.aggregate({
      where: {
        walletId,
        status: 'completed',
      },
      _sum: {
        netAmount: true,
      },
    });

    return Number(result._sum.netAmount) || 0;
  }
}