import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { WalletsService } from '../wallets/wallets.service';
import type {
  CreateOrderDto,
  DeliverOrderDto,
  OrderFilterDto,
  CancelOrderDto,
  RequestRevisionDto,
} from './dto/order.dto';
import { Order, Service, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private walletService: WalletsService,
    private notificationService: NotificationsService,
  ) {}

  /**
   * Membuat order baru
   *
   * Proses ini melibatkan beberapa langkah:
   * 1. Validasi bahwa service exists dan aktif
   * 2. Validasi bahwa buyer bukan pemilik service (tidak bisa order jasa sendiri)
   * 3. Hitung deadline berdasarkan deliveryTime service
   * 4. Buat snapshot data service saat itu (harga, deliveryTime, revisions)
   *    karena seller bisa mengubah service tapi order harus tetap sesuai agreement awal
   * 5. Set status awal sebagai DRAFT
   */
  async create(buyerId: string, dto: CreateOrderDto) {
    // Ambil data service lengkap
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    // Validasi service
    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (!service.isActive || service.status !== 'ACTIVE') {
      throw new BadRequestException('Jasa tidak tersedia saat ini');
    }

    // Cek apakah buyer mencoba order jasa sendiri
    if (service.sellerId === buyerId) {
      throw new BadRequestException(
        'Anda tidak dapat memesan jasa Anda sendiri',
      );
    }

    // Hitung deadline
    // Jika custom deadline diberikan, gunakan itu
    // Jika tidak, tambahkan deliveryTime ke tanggal sekarang
    let dueDate: Date;
    if (dto.customDeadline) {
      dueDate = dto.customDeadline;
      // Validasi bahwa custom deadline tidak di masa lalu
      if (dueDate < new Date()) {
        throw new BadRequestException('Deadline tidak boleh di masa lalu');
      }
    } else {
      dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + service.deliveryTime);
    }

    // Buat order dengan snapshot data service
    const order = await this.prisma.order.create({
      data: {
        serviceId: service.id,
        buyerId,
        title: service.title, // Snapshot title
        price: service.price, // Snapshot harga
        deliveryTime: service.deliveryTime, // Snapshot delivery time
        maxRevisions: service.revisions, // Snapshot jumlah revisi
        requirements: dto.requirements,
        attachments: dto.attachments,
        dueDate,
        status: 'DRAFT',
        isPaid: false,
        revisionCount: 0,
      },
      include: {
        service: {
          select: {
            id: true,
            title: true,
            category: true,
          },
        },
        buyer: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });

    return order;
  }

  /**
   * Konfirmasi order dan siap untuk pembayaran
   *
   * Mengubah status dari DRAFT ke WAITING_PAYMENT
   * Di sini seharusnya kita juga generate payment link dari Midtrans/Xendit
   * Untuk sekarang, kita akan return payment instructions
   */
  async confirmOrder(
    orderId: string,
    buyerId: string,
  ): Promise<{
    order: Order;
    message: string;
    paymentToken: string;
    paymentRedirectUrl: string;
  }> {
    const order = await this.findOneWithAccess(orderId, buyerId, 'buyer');

    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Hanya order dengan status draft yang bisa dikonfirmasi',
      );
    }

    // Update status ke waiting_payment
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'WAITING_PAYMENT' },
      include: {
        buyer: true,
      },
    });

    // Implementasi TODO: Integrate dengan payment gateway
    const paymentDetails = await this.paymentsService.createPayment(
      updated,
      updated.buyer,
    );

    return {
      order: updated,
      message: 'Silakan lakukan pembayaran untuk melanjutkan pesanan',
      paymentToken: paymentDetails.token!,
      paymentRedirectUrl: paymentDetails.redirectUrl!,
    };
  }

  /**
   * Listener untuk event 'payment.settled'
   * Ini menggantikan panggilan dari PaymentsController
   *
   * @param payload - { orderId: string, transactionData: any }
   */
  @OnEvent('payment.settled')
  async handlePaymentSuccess(payload: {
    orderId: string;
    transactionData: Record<string, unknown>;
  }) {
    const { orderId, transactionData } = payload;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      console.error(`[PaymentSettled] Order ${orderId} not found`);
      return;
    }

    if (order.isPaid) {
      console.log(`[PaymentSettled] Order ${orderId} already paid`);
      return; // Idempotency
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Update order status
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'PAID_ESCROW',
            isPaid: true,
            paidAt: new Date(),
          },
        });

        const txId = transactionData.transaction_id as string;
        const pType = transactionData.payment_type as string;

        await tx.payment.update({
          where: { orderId: orderId },
          data: {
            status: 'SETTLEMENT',
            transactionId: txId,
            paymentType: pType,
          },
        });

        const service = await tx.service.findUniqueOrThrow({
          where: { id: order.serviceId },
          select: { sellerId: true },
        });

        // Buat notifikasi untuk Seller
        await this.notificationService.createInTx(tx, {
          userId: service.sellerId,
          content: `Pesanan baru #${order.id.substring(0, 8)} telah dibayar!`,
          link: `/seller/orders/${order.id}`,
          type: 'ORDER',
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[PaymentSettled] Failed to process order ${orderId}:`,
        message,
      );
    }
  }

  /**
   * Seller memulai pengerjaan
   *
   * Mengubah status dari PAID_ESCROW ke IN_PROGRESS
   */
  async startWork(orderId: string, sellerId: string) {
    // Ambil order dengan validasi akses seller
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        service: {
          sellerId,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'PAID_ESCROW') {
      throw new BadRequestException(
        'Hanya order yang sudah dibayar yang bisa dimulai',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'IN_PROGRESS' },
      include: {
        buyer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    // TODO: Kirim notifikasi ke buyer bahwa pekerjaan dimulai

    return updated;
  }

  /**
   * Seller mengirimkan hasil kerja
   *
   * Mengubah status dari IN_PROGRESS atau REVISION ke DELIVERED
   */
  async deliverWork(orderId: string, sellerId: string, dto: DeliverOrderDto) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        service: {
          sellerId,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'IN_PROGRESS' && order.status !== 'REVISION') {
      throw new BadRequestException(
        'Order harus dalam status dikerjakan atau revisi',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'DELIVERED',
        deliveryFiles: dto.deliveryFiles,
        deliveryNote: dto.deliveryNote,
        deliveredAt: new Date(),
      },
      include: {
        buyer: true,
      },
    });

    // Buat notifikasi untuk Buyer
    await this.notificationService.create({
      userId: updated.buyerId,
      content: `Pekerjaan untuk pesanan #${updated.id.substring(0, 8)} telah dikirim!`,
      link: `/buyer/orders/${updated.id}`,
      type: 'ORDER',
    });

    return updated;
  }

  /**
   * Buyer meminta revisi
   *
   * Mengubah status dari DELIVERED ke REVISION
   * Validasi jumlah revisi yang tersisa
   */
  async requestRevision(
    orderId: string,
    buyerId: string,
    dto: RequestRevisionDto,
  ) {
    const order = await this.findOneWithAccess(orderId, buyerId, 'buyer');

    if (order.status !== 'DELIVERED') {
      throw new BadRequestException(
        'Revisi hanya bisa diminta setelah hasil dikirim',
      );
    }

    // Cek apakah masih ada jatah revisi
    if (order.revisionCount >= order.maxRevisions) {
      throw new BadRequestException(
        `Anda sudah menggunakan semua ${order.maxRevisions} kali revisi yang tersedia`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'REVISION',
        revisionCount: {
          increment: 1,
        },
        revisionNotes: {
          push: dto.revisionNote,
        },
      },
    });

    // TODO: Simpan detail revisi request
    // TODO: Kirim notifikasi ke seller tentang revisi

    return updated;
  }

  /**
   * Buyer menyetujui hasil kerja
   *
   * Ini adalah langkah paling kritis:
   * - Mengubah status menjadi COMPLETED
   * - Melepas escrow ke seller
   * - Update statistik seller
   * - Memungkinkan review
   */
  async approveWork(orderId: string, buyerId: string) {
    const order = await this.findOneWithAccess(orderId, buyerId, 'buyer');

    if (order.status !== 'DELIVERED') {
      throw new BadRequestException(
        'Hanya hasil yang sudah dikirim yang bisa disetujui',
      );
    }

    return this.completeOrder(orderId, order.service.sellerId);
  }

  /**
   * Membatalkan order
   *
   * Aturan pembatalan:
   * - Buyer bisa cancel jika status masih DRAFT atau WAITING_PAYMENT
   * - Seller bisa cancel jika status PAID_ESCROW dengan alasan valid
   * - Jika sudah IN_PROGRESS atau lebih lanjut, harus lewat dispute
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    role: 'buyer' | 'seller',
    dto: CancelOrderDto,
  ): Promise<Order & { refunded: boolean }> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...(role === 'buyer'
          ? { buyerId: userId }
          : { service: { sellerId: userId } }),
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Validasi status untuk pembatalan
    const cancellableStatuses = ['draft', 'waiting_payment', 'paid_escrow'];
    if (!cancellableStatuses.includes(order.status)) {
      throw new BadRequestException(
        'Order dengan status ini tidak bisa dibatalkan. Silakan buka dispute jika ada masalah.',
      );
    }

    // Jika order sudah dibayar, perlu refund
    const needsRefund = order.isPaid;
    let cancelled: Order;

    // Gunakan transaction jika perlu refund
    if (needsRefund) {
      cancelled = await this.prisma.$transaction(async (tx) => {
        const cancelledOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: dto.reason,
          },
        });

        // Implementasi TODO: Jika needs refund, proses refund
        // Kembalikan dana ke wallet buyer
        const buyerWallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: order.buyerId },
        });

        await this.walletService.createTransaction({
          tx,
          walletId: buyerWallet.id,
          orderId: order.id,
          type: 'ESCROW_REFUND',
          amount: order.price.toNumber(), // Positif
          description: `Refund untuk order dibatalkan #${order.id.substring(0, 8)}`,
        });

        return cancelledOrder;
      });
    } else {
      // Jika tidak perlu refund, update biasa
      cancelled = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: dto.reason,
        },
      });
    }

    return { ...cancelled, refunded: needsRefund };
  }

  /**
   * Get all orders dengan filtering
   *
   * Mendukung view dari perspektif buyer atau seller
   */
  async findAll(userId: string, filters: OrderFilterDto) {
    const { role, status, search, page, limit, sortBy } = filters;

    // --- TAMBAHKAN KONVERSI MANUAL DI SINI ---
    // Pastikan page dan limit adalah number valid
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: Prisma.OrderWhereInput = {};

    // ... (kode filter role, status, search biarkan sama) ...

    // Build order by
    let orderBy: Prisma.OrderOrderByWithRelationInput = {};
    switch (sortBy) {
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'deadline':
        orderBy = { dueDate: 'asc' };
        break;
      case 'price_high':
        orderBy = { price: 'desc' };
        break;
      case 'price_low':
        orderBy = { price: 'asc' };
        break;
      default:
        orderBy = { createdAt: 'desc' }; // Tambahkan default fallback
    }

    // Execute queries
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip, // Sekarang pasti number (bukan NaN)
        take: limitNum, // Sekarang pasti number (bukan string)
        include: {
          service: {
            select: {
              id: true,
              title: true,
              category: true,
              images: true,
            },
          },
          buyer: {
            select: {
              id: true,
              fullName: true,
              profilePicture: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get detail order
   */
  async findOne(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ buyerId: userId }, { service: { sellerId: userId } }],
      },
      include: {
        service: {
          include: {
            seller: {
              select: {
                id: true,
                fullName: true,
                profilePicture: true,
                bio: true,
                major: true,
                avgRating: true,
                totalReviews: true,
              },
            },
          },
        },
        buyer: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
          },
        },
        review: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    return order;
  }

  /**
   * Helper method untuk validasi akses
   */
  private async findOneWithAccess(
    orderId: string,
    userId: string,
    requiredRole: 'buyer' | 'seller',
  ): Promise<Order & { service: Service }> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...(requiredRole === 'buyer'
          ? { buyerId: userId }
          : { service: { sellerId: userId } }),
      },
      include: {
        service: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    return order;
  }

  /**
   * [BARU] Helper terpusat untuk menyelesaikan order & melepas dana
   * Dipanggil oleh approveWork (buyer) atau resolveDispute (admin)
   */
  async completeOrder(orderId: string, sellerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const completedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED', // (Gunakan Enum)
          completedAt: new Date(),
        },
        include: {
          service: true,
        },
      });

      // 1. Update statistik service
      await tx.service.update({
        where: { id: completedOrder.serviceId },
        data: {
          totalOrders: { increment: 1 },
        },
      });

      // 2. Update statistik seller
      await tx.user.update({
        where: { id: sellerId },
        data: {
          totalOrdersCompleted: { increment: 1 },
        },
      });

      // 3. Lepas dana (Escrow Release)
      const sellerWallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: sellerId },
      });

      const orderPrice = completedOrder.price.toNumber();
      const platformFee = orderPrice * 0.1; // 10% fee
      const amountToSeller = orderPrice - platformFee;

      await this.walletService.createTransaction({
        tx,
        walletId: sellerWallet.id,
        orderId: completedOrder.id,
        type: 'ESCROW_RELEASE', // (Gunakan Enum)
        amount: amountToSeller,
        description: `Pelepasan dana untuk order #${completedOrder.id.substring(0, 8)}`,
      });

      return completedOrder;
    });
  }
}
