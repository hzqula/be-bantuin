import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from 'src/wallets/wallets.service';
import type { ResolveDisputeDto } from 'src/disputes/dto/resolve-dispute.dto';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletsService,
    private notificationService: NotificationsService,
  ) {}

  /**
   * Mendapatkan daftar PayoutRequest yang masih 'pending'
   */
  async getPendingPayouts() {
    return this.prisma.payoutRequest.findMany({
      where: { status: 'pending' },
      orderBy: { requestedAt: 'asc' },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        account: true, // Info rekening bank
      },
    });
  }

  /**
   * Menyetujui PayoutRequest
   * Asumsi: Admin mentransfer dana secara manual, lalu menekan tombol ini.
   */
  async approvePayout(payoutId: string) {
    const payout = await this.prisma.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: 'completed',
        processedAt: new Date(),
        adminNotes: 'Disetujui dan telah diproses.',
      },
    });

    // Buat notifikasi untuk Seller
    await this.notificationService.create({
      userId: payout.userId,
      content: `Penarikan dana Anda sebesar Rp ${payout.amount} telah disetujui.`,
      link: `/wallet/payouts`,
      type: 'WALLET',
    });
  }

  /**
   * Menolak PayoutRequest
   * Dana harus dikembalikan ke wallet user.
   */
  async rejectPayout(payoutId: string, reason: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new NotFoundException('Permintaan penarikan tidak ditemukan');
    }
    if (payout.status !== 'pending') {
      throw new BadRequestException(
        `Permintaan ini sudah berstatus ${payout.status}`,
      );
    }

    // Gunakan $transaction untuk memastikan status diupdate DAN dana dikembalikan
    return this.prisma.$transaction(async (tx) => {
      // 1. Update status PayoutRequest
      const rejectedPayout = await tx.payoutRequest.update({
        where: { id: payoutId },
        data: {
          status: 'rejected',
          processedAt: new Date(),
          adminNotes: reason,
        },
      });

      // 2. Kembalikan dana ke wallet user
      // Memanggil method createTransaction dari WalletService
      await this.walletService.createTransaction({
        tx,
        walletId: payout.walletId,
        type: 'PAYOUT_REJECTED',
        amount: payout.amount.toNumber(), // POSITIF (Credit), dana kembali
        description: `Pengembalian dana penarikan ditolak: ${reason}`,
        payoutRequestId: payout.id,
      });

      // Buat notifikasi untuk Seller
      await this.notificationService.createInTx(tx, {
        userId: rejectedPayout.userId,
        content: `Penarikan dana Anda ditolak. Alasan: ${reason}`,
        link: `/wallet/payouts`,
        type: 'WALLET',
      });

      return rejectedPayout;
    });
  }
  // --- Metode Manajemen Sengketa ---

  /**
   * [Admin] Mendapatkan daftar sengketa yang terbuka
   */
  async getOpenDisputes() {
    return this.prisma.dispute.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          select: { id: true, title: true, price: true },
        },
        openedBy: {
          select: { id: true, fullName: true },
        },
      },
    });
  }

  /**
   * [Admin] Menyelesaikan sengketa
   * Ini adalah operasi atomik yang kritis
   */
  async resolveDispute(
    adminId: string,
    disputeId: string,
    dto: ResolveDisputeDto,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        order: {
          include: { service: { select: { sellerId: true } } },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundException('Sengketa tidak ditemukan');
    }
    if (dispute.status !== 'OPEN') {
      throw new BadRequestException('Sengketa ini sudah diselesaikan');
    }

    // Mulai transaksi atomik
    return this.prisma.$transaction(async (tx) => {
      const resolvedDispute = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolution: dto.resolution,
          adminNotes: dto.adminNotes,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });

      const sellerId = dispute.order.service.sellerId;
      const buyerId = dispute.order.buyerId;

      // Buat notifikasi untuk Buyer
      await this.notificationService.createInTx(tx, {
        userId: buyerId,
        content: `Sengketa untuk pesanan #${dispute.orderId.substring(0, 8)} telah diselesaikan.`,
        link: `/orders/${dispute.orderId}/dispute`,
        type: 'DISPUTE',
      });
      // Buat notifikasi untuk Seller
      await this.notificationService.createInTx(tx, {
        userId: sellerId,
        content: `Sengketa untuk pesanan #${dispute.orderId.substring(0, 8)} telah diselesaikan.`,
        link: `/orders/${dispute.orderId}/dispute`,
        type: 'DISPUTE',
      });

      return resolvedDispute;
    });
  }
}