import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletsService } from '../wallets/wallets.service';
import { OrdersService } from '../orders/orders.service';
import type { ResolveDisputeDto } from '../disputes/dto/resolve-dispute.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletsService,
    private notificationService: NotificationsService,
    private ordersService: OrdersService,
  ) { }

  /**
   * [Admin] Get services that are pending review
   */
  async getPendingServices() {
    return this.prisma.service.findMany({
      // cast to any because Prisma client types may need regeneration after schema change
      where: { status: 'PENDING' as any },
      orderBy: { createdAt: 'asc' },
      include: {
        seller: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });
  }

  /**
   * [Admin] Get service details by ID
   */
  async getServiceById(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profilePicture: true,
            createdAt: true,
          },
        },
        reviews: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { fullName: true, profilePicture: true } },
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    return service;
  }

  /**
   * [Admin] Approve a pending service
   */
  async approveService(adminId: string, serviceId: string) {
    const svc = await this.prisma.service.findUnique({
      where: { id: serviceId },
    });
    if (!svc) throw new NotFoundException('Jasa tidak ditemukan');
    if (svc.status !== ('PENDING' as any)) {
      throw new BadRequestException(
        'Hanya jasa dengan status PENDING yang dapat disetujui',
      );
    }

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'ACTIVE' as any,
        isActive: true,
        adminNotes: `Approved by ${adminId}` as any,
      },
      include: { seller: { select: { id: true } } },
    });

    // Notify seller
    await this.notificationService.create({
      userId: svc.sellerId,
      content: `Jasa "${updated.title}" telah disetujui oleh administrator dan sekarang aktif.`,
      link: `/services/${updated.id}`,
      type: 'GENERAL',
    });

    return updated;
  }

  /**
   * [Admin] Reject a pending service with reason
   */
  async rejectService(adminId: string, serviceId: string, reason: string) {
    const svc = await this.prisma.service.findUnique({
      where: { id: serviceId },
    });
    if (!svc) throw new NotFoundException('Jasa tidak ditemukan');
    if (svc.status !== ('PENDING' as any)) {
      throw new BadRequestException(
        'Hanya jasa dengan status PENDING yang dapat ditolak',
      );
    }

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'REJECTED' as any,
        isActive: false,
        adminNotes: reason as any,
      },
      include: { seller: { select: { id: true } } },
    });

    // Notify seller
    await this.notificationService.create({
      userId: svc.sellerId,
      content: `Jasa "${updated.title}" ditolak oleh administrator. Alasan: ${reason}`,
      link: `/services/${updated.id}`,
      type: 'GENERAL',
    });

    return updated;
  }

  /**
   * Mendapatkan daftar PayoutRequest yang masih 'pending'
   */
  async getPendingPayouts() {
    return this.prisma.payoutRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        account: true,
        wallet: {
          select: { balance: true },
        },
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
        status: 'COMPLETED',
        processedAt: new Date(),
        adminNotes: 'Disetujui dan telah diproses.',
      },
    });

    // Buat notifikasi untuk Seller
    await this.notificationService.create({
      userId: payout.userId,
      content: `Penarikan dana Anda sebesar Rp ${payout.amount.toNumber()} telah disetujui.`,
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
    if (payout.status !== 'PENDING') {
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
          status: 'REJECTED',
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

      // --- PERBAIKAN LOGIKA BISNIS YANG HILANG ---
      if (dto.resolution === 'REFUND_TO_BUYER') {
        // 1. Update status order
        await tx.order.update({
          where: { id: dispute.orderId },
          data: { status: 'RESOLVED' },
        });

        // 2. Proses Refund ke Wallet Buyer
        const buyerWallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: buyerId },
        });
        await this.walletService.createTransaction({
          tx,
          walletId: buyerWallet.id,
          orderId: dispute.orderId,
          type: 'DISPUTE_REFUND',
          amount: dispute.order.price.toNumber(), // Refund penuh
          description: `Refund sengketa order #${dispute.orderId.substring(0, 8)}`,
        });
      } else if (dto.resolution === 'RELEASE_TO_SELLER') {
        // 1. Selesaikan order menggunakan logika terpusat
        // Ini akan update status order, update statistik, & melepas dana
        await this.ordersService.completeOrder(dispute.orderId, sellerId);

        // 2. (Opsional) Ganti tipe transaksi wallet agar spesifik
        // Kita bisa tambahkan logic di completeOrder untuk menerima tipe
        // Tapi untuk saat ini, ini sudah 100% fungsional
      }

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

  /**
   * [Admin] Mendapatkan statistik dashboard (Total Saldo & Total Pendapatan)
   * Menggunakan aggregasi Prisma untuk perhitungan yang efisien.
   */
  async getDashboardStats() {
    // 1. Hitung Total Saldo Keseluruhan (Sum of all active wallets)
    const totalBalanceResult = await this.prisma.wallet.aggregate({
      _sum: {
        balance: true,
      },
    });

    // 2. Hitung Total Pendapatan Platform (10% dari total order COMPLETED)
    const totalCompletedOrdersPrice = await this.prisma.order.aggregate({
      where: {
        status: 'COMPLETED',
      },
      _sum: {
        price: true,
      },
    });

    // 3. Hitung Total Pengguna Aktif (Bukan Admin dan tidak di-ban) <-- BARU
    const totalActiveUsers = await this.prisma.user.count({
      where: {
        role: {
          not: 'ADMIN',
        },
        status: 'active',
      },
    });

    // Asumsi fee platform 10%
    const totalRevenue = totalCompletedOrdersPrice._sum.price
      ? totalCompletedOrdersPrice._sum.price.toNumber() * 0.1
      : 0;

    return {
      totalUserBalance: totalBalanceResult._sum.balance || 0,
      totalPlatformRevenue: totalRevenue,
      totalActiveUsers: totalActiveUsers,
    };
  }

  /**
   * [Admin] Mendapatkan riwayat uang masuk (Transaksi Kredit/Positif)
   */
  async getIncomeHistory() {
    // Ambil transaksi yang bernilai positif (uang masuk/credit) ke wallet user.
    return this.prisma.walletTransaction.findMany({
      where: {
        type: {
          in: ['ESCROW_RELEASE', 'PAYOUT_REJECTED', 'DISPUTE_REFUND'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        wallet: {
          select: {
            user: {
              select: { fullName: true, profilePicture: true },
            },
          },
        },
        order: {
          select: { title: true },
        },
      },
    });
  }

  async getAllUsers(page = 1, limit = 10, search = '') {
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          isSeller: true,
          isVerified: true,
          createdAt: true,
          profilePicture: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async banUser(userId: string) {
    // Cek dulu apakah user admin (jangan ban sesama admin)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'ADMIN') {
      throw new BadRequestException(
        'Tidak dapat memblokir sesama Administrator',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'banned' },
    });
  }

  /**
   * [Admin] Unban User (Kembalikan status jadi 'active')
   */
  async unbanUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    });
  }
}
