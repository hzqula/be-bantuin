import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReviewDto } from './dto/create-review.dto';
import type { RespondReviewDto } from './dto/respond-review.dto';
import type { PrismaClient } from '@prisma/client';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationsService,
  ) {}

  /**
   * Membuat review baru oleh Buyer
   */
  async createReview(buyerId: string, orderId: string, dto: CreateReviewDto) {
    // 1. Validasi Order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        review: true, // Cek apakah sudah ada review
      },
    });

    if (!order) {
      throw new NotFoundException('Pesanan tidak ditemukan');
    }
    if (order.buyerId !== buyerId) {
      throw new ForbiddenException('Anda bukan pembeli dari pesanan ini');
    }
    if (order.status !== 'completed') {
      throw new BadRequestException(
        'Review hanya bisa diberikan untuk pesanan yang sudah selesai',
      );
    }
    if (order.review) {
      throw new BadRequestException(
        'Anda sudah memberikan review untuk pesanan ini',
      );
    }

    // 2. Dapatkan ID seller
    const service = await this.prisma.service.findUnique({
      where: { id: order.serviceId },
      select: { sellerId: true },
    });
    if (!service) {
      throw new NotFoundException('Jasa terkait tidak ditemukan');
    }

    // 3. Buat Review dan Update Rating (dalam satu transaksi)
    return this.prisma.$transaction(async (tx) => {
      // Buat review
      const review = await tx.review.create({
        data: {
          orderId,
          serviceId: order.serviceId,
          authorId: buyerId,
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      // Update agregat rating
      await this.updateAggregates(tx, order.serviceId, service.sellerId);

      // Buat notifikasi untuk Seller
      await this.notificationService.createInTx(tx, {
        userId: service.sellerId,
        content: `Anda menerima review ${dto.rating} bintang untuk pesanan #${orderId.substring(0, 8)}.`,
        link: `/services/${order.serviceId}/reviews`,
        type: 'REVIEW',
      });

      return review;
    });
  }

  /**
   * Memberikan tanggapan untuk review oleh Seller
   */
  async respondToReview(
    sellerId: string,
    reviewId: string,
    dto: RespondReviewDto,
  ) {
    // 1. Validasi Review
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        service: {
          select: { sellerId: true },
        },
      },
    });

    if (!review) {
      throw new NotFoundException('Review tidak ditemukan');
    }
    if (review.service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda bukan pemilik jasa dari review ini');
    }
    if (review.sellerResponse) {
      throw new BadRequestException('Anda sudah menanggapi review ini');
    }

    // 2. Update Review dengan tanggapan
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        sellerResponse: dto.response,
        respondedAt: new Date(),
      },
    });
  }

  /**
   * Mendapatkan semua review untuk sebuah Service (Public)
   */
  async getServiceReviews(serviceId: string) {
    return this.prisma.review.findMany({
      where: { serviceId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          // Tampilkan info si pemberi review
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
          },
        },
      },
    });
  }

  /**
   * [Private] Helper untuk mengkalkulasi ulang rating
   * Dijalankan di dalam transaksi setelah review baru dibuat
   */
  private async updateAggregates(
    tx: Omit<
      PrismaClient,
      '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
    >,
    serviceId: string,
    sellerId: string,
  ) {
    // 1. Update agregat Service
    const serviceStats = await tx.review.aggregate({
      where: { serviceId },
      _avg: { rating: true },
      _count: { id: true },
    });

    await tx.service.update({
      where: { id: serviceId },
      data: {
        avgRating: serviceStats._avg.rating || 0,
        totalReviews: serviceStats._count.id,
      },
    });

    // 2. Update agregat Seller (User)
    // Ini menghitung rata-rata dari SEMUA service milik seller
    const sellerStats = await tx.review.aggregate({
      where: { service: { sellerId } },
      _avg: { rating: true },
      _count: { id: true },
    });

    await tx.user.update({
      where: { id: sellerId },
      data: {
        avgRating: sellerStats._avg.rating || 0,
        totalReviews: sellerStats._count.id,
      },
    });
  }
}