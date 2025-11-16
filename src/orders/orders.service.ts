import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { WalletsService } from 'src/wallets/wallets.service';
import type {
  CreateOrderDto,
  DeliverOrderDto,
  RequestRevisionDto,
  OrderFilterDto,
  CancelOrderDto,
} from './dto/order.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from 'src/notifications/notifications.service';

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

    if (!service.isActive || service.status !== 'active') {
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
        status: 'draft',
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
    order: any;
    message: string;
    paymentToken: string;
    paymentRedirectUrl: string;
  }> {
    const order = await this.findOneWithAccess(orderId, buyerId, 'buyer');

    if (order.status !== 'draft') {
      throw new BadRequestException(
        'Hanya order dengan status draft yang bisa dikonfirmasi',
      );
    }

    // Update status ke waiting_payment
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'waiting_payment' },
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
      paymentToken: paymentDetails.token,
      paymentRedirectUrl: paymentDetails.redirectUrl,
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
    transactionData: any;
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
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'paid_escrow',
            isPaid: true,
            paidAt: new Date(),
          },
        });

        await tx.payment.update({
          where: { orderId: orderId },
          data: {
            status: 'settlement',
            transactionId: transactionData.transaction_id,
            paymentType: transactionData.payment_type,
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
      console.error(
        `[PaymentSettled] Failed to process order ${orderId}:`,
        error,
      );
      // Jika gagal, event ini perlu di-retry (bisa menggunakan queue/antrian)
      // Untuk saat ini, kita log error-nya
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

    if (order.status !== 'paid_escrow') {
      throw new BadRequestException(
        'Hanya order yang sudah dibayar yang bisa dimulai',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'in_progress' },
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

    if (order.status !== 'in_progress' && order.status !== 'revision') {
      throw new BadRequestException(
        'Order harus dalam status dikerjakan atau revisi',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'delivered',
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

    if (order.status !== 'delivered') {
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
        status: 'revision',
        revisionCount: {
          increment: 1,
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

    if (order.status !== 'delivered') {
      throw new BadRequestException(
        'Hanya hasil yang sudah dikirim yang bisa disetujui',
      );
    }

    // Gunakan transaction untuk atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Update order status
      const completedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
        include: {
          service: true,
        },
      });

      // Update statistik service
      await tx.service.update({
        where: { id: completedOrder.serviceId },
        data: {
          totalOrders: {
            increment: 1,
          },
        },
      });

      // Update statistik seller
      await tx.user.update({
        where: { id: completedOrder.service.sellerId },
        data: {
          totalOrdersCompleted: {
            increment: 1,
          },
        },
      });

      // TODO: Release escrow
      const sellerWallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: completedOrder.service.sellerId },
      });

      // Hitung fee platform (misal 10%)
      const orderPrice = completedOrder.price.toNumber();
      const platformFee = orderPrice * 0.1; // 10% fee
      const amountToSeller = orderPrice - platformFee;

      // Gunakan WalletService untuk mencatat transaksi
      await this.walletService.createTransaction({
        tx,
        walletId: sellerWallet.id,
        orderId: completedOrder.id,
        type: 'ESCROW_RELEASE',
        amount: amountToSeller, // Positif
        description: `Pelepasan dana untuk order #${completedOrder.id.substring(0, 8)}`,
      });

      return completedOrder;
    });

    // TODO: Kirim notifikasi ke seller tentang penyelesaian
    // TODO: Kirim reminder ke buyer untuk memberikan review

    return result;
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
  ) {
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
    let cancelled;

    // Gunakan transaction jika perlu refund
    if (needsRefund) {
      cancelled = await this.prisma.$transaction(async (tx) => {
        const cancelledOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'cancelled',
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
          status: 'cancelled',
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

    // Build where clause
    const where: Prisma.OrderWhereInput = {};

    // Filter berdasarkan role
    if (role === 'buyer') {
      where.buyerId = userId;
    } else if (role === 'worker') {
      where.service = {
        sellerId: userId,
      };
    } else {
      // Jika tidak ada role specified, ambil semua order user tersebut
      where.OR = [{ buyerId: userId }, { service: { sellerId: userId } }];
    }

    // Filter status
    if (status) {
      where.status = status;
    }

    // Search by title
    if (search) {
      where.title = {
        contains: search,
        mode: 'insensitive',
      };
    }

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
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Execute queries
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: limit,
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
        page,
        limit,
        totalPages: Math.ceil(total / limit),
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
  ) {
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
}