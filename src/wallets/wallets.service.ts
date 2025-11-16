import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, Wallet } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { CreatePayoutAccountDto } from './dto/payout-account.dto';
import type { CreatePayoutRequestDto } from './dto/payout-request.dto';

type TransactionInput = {
  tx: Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
  >;
  walletId: string;
  type: string;
  amount: number;
  description: string;
  orderId?: string;
  paymentId?: string;
  payoutRequestId?: string;
};

@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Membuat wallet baru untuk user
   */
  async createWallet(userId: string): Promise<Wallet> {
    return this.prisma.wallet.create({
      data: {
        userId,
        balance: 0,
      },
    });
  }

  /**
   * Mendapatkan wallet user.
   * Jika tidak ada, buatkan yang baru (lazy-init).
   */
  async getWalletByUserId(userId: string): Promise<Wallet> {
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      wallet = await this.createWallet(userId);
    }

    return wallet;
  }

  /**
   * Mendapatkan riwayat transaksi wallet
   */
  async getWalletHistory(userId: string) {
    const wallet = await this.getWalletByUserId(userId);

    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // --- Metode Payout Account ---

  async addPayoutAccount(userId: string, dto: CreatePayoutAccountDto) {
    try {
      // Cek duplikat
      const existing = await this.prisma.payoutAccount.findFirst({
        where: { userId, accountNumber: dto.accountNumber },
      });
      if (existing) {
        throw new ConflictException('Nomor rekening ini sudah terdaftar');
      }

      const account = await this.prisma.payoutAccount.create({
        data: {
          userId,
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          isPrimary: false, // User bisa set primary nanti
        },
      });
      return account;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Gagal menambahkan rekening');
    }
  }

  async listPayoutAccounts(userId: string) {
    return this.prisma.payoutAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removePayoutAccount(userId: string, accountId: string) {
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException('Rekening tidak ditemukan');
    }
    if (account.userId !== userId) {
      throw new ForbiddenException('Anda tidak memiliki akses');
    }

    // Cek jika ada payout pending ke akun ini
    const pending = await this.prisma.payoutRequest.count({
      where: { accountId, status: 'pending' },
    });

    if (pending > 0) {
      throw new BadRequestException(
        'Tidak dapat menghapus rekening dengan permintaan penarikan yang masih pending',
      );
    }

    await this.prisma.payoutAccount.delete({
      where: { id: accountId },
    });
  }

  // --- Metode Payout Request ---

  async createPayoutRequest(userId: string, dto: CreatePayoutRequestDto) {
    // Validasi minimal penarikan
    if (dto.amount < 50000) {
      throw new BadRequestException('Minimal penarikan adalah Rp 50.000');
    }

    // Mulai transaksi atomik
    return this.prisma.$transaction(async (tx) => {
      // 1. Dapatkan wallet & lock (by checking balance)
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
      });

      // 2. Cek saldo
      if (wallet.balance.toNumber() < dto.amount) {
        throw new BadRequestException('Saldo Anda tidak mencukupi');
      }

      // 3. Verifikasi kepemilikan rekening bank
      const account = await tx.payoutAccount.findUniqueOrThrow({
        where: { id: dto.payoutAccountId },
      });
      if (account.userId !== userId) {
        throw new ForbiddenException('Rekening bank tidak valid');
      }

      // 4. Buat PayoutRequest (status pending)
      const payoutRequest = await tx.payoutRequest.create({
        data: {
          userId,
          walletId: wallet.id,
          accountId: account.id,
          amount: dto.amount,
          status: 'pending',
        },
      });

      // 5. Potong saldo wallet (debit) menggunakan createTransaction
      // Ini akan mengunci saldo
      await this.createTransaction({
        tx,
        walletId: wallet.id,
        type: 'PAYOUT_REQUEST',
        amount: -dto.amount, // Negatif karena mengurangi saldo
        description: `Penarikan ke ${account.bankName} - ${account.accountNumber}`,
        payoutRequestId: payoutRequest.id, // Link ke request
      });

      return payoutRequest;
    });
  }

  async listPayoutRequests(userId: string) {
    return this.prisma.payoutRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      include: {
        account: {
          select: {
            bankName: true,
            accountName: true,
            accountNumber: true,
          },
        },
      },
    });
  }

  /**
   * Membuat transaksi wallet secara atomic.
   * Ini adalah method inti untuk semua perubahan saldo.
   * (Modifikasi dari Phase 3 untuk menambah payoutRequestId)
   */
  async createTransaction(input: TransactionInput) {
    const {
      tx,
      walletId,
      type,
      amount,
      description,
      orderId,
      paymentId,
      payoutRequestId,
    } = input;

    try {
      // 1. Dapatkan saldo saat ini
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: walletId },
      });

      const balanceBefore = wallet.balance.toNumber();
      const balanceAfter = balanceBefore + amount;

      // 2. Cek jika saldo mencukupi
      if (balanceAfter < 0) {
        throw new InternalServerErrorException('Saldo tidak mencukupi');
      }

      // 3. Update saldo wallet
      await tx.wallet.update({
        where: { id: walletId },
        data: {
          balance: balanceAfter,
        },
      });

      // 4. Catat di ledger (WalletTransaction)
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId,
          type,
          amount,
          description,
          orderId,
          paymentId,
          payoutRequestId, // Simpan ID request
          balanceBefore,
          balanceAfter,
        },
      });

      return transaction;
    } catch (error) {
      console.error('Error in createTransaction:', error);
      throw new InternalServerErrorException(
        `Gagal memproses transaksi: ${error.message}`,
      );
    }
  }
}