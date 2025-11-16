import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDisputeDto } from './dto/create-dispute.dto';
import type { AddDisputeMessageDto } from './dto/add-message.dto';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class DisputesService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationsService,
  ) {}

  /**
   * [User] Membuka sengketa baru
   */
  async openDispute(userId: string, orderId: string, dto: CreateDisputeDto) {
    // 1. Validasi Order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { service: { select: { sellerId: true } } },
    });

    if (!order) {
      throw new NotFoundException('Pesanan tidak ditemukan');
    }

    // 2. Validasi User (harus buyer atau seller)
    const isBuyer = order.buyerId === userId;
    const isSeller = order.service.sellerId === userId;

    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('Anda tidak terkait dengan pesanan ini');
    }

    // 3. Validasi Status Order
    // Hanya order yang sedang berjalan/terkirim yang bisa didispute
    const disputableStatuses = ['in_progress', 'delivered', 'revision'];
    if (!disputableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Pesanan dengan status ${order.status} tidak dapat disengketakan`,
      );
    }

    // 4. Buat Dispute dan update status Order (transaksional)
    return this.prisma.$transaction(async (tx) => {
      // Update status order menjadi 'disputed'
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'disputed' },
      });

      // Buat entri dispute
      const dispute = await tx.dispute.create({
        data: {
          orderId,
          openedById: userId,
          reason: dto.reason,
          status: 'OPEN',
        },
      });

      // Tentukan pihak lain
      const isBuyer = order.buyerId === userId;
      const otherPartyId = isBuyer ? order.service.sellerId : order.buyerId;

      // Buat notifikasi untuk pihak lain
      await this.notificationService.createInTx(tx, {
        userId: otherPartyId,
        content: `Sengketa telah dibuka untuk pesanan #${orderId.substring(0, 8)}.`,
        link: `/orders/${orderId}/dispute`,
        type: 'DISPUTE',
      });

      // Buat notifikasi untuk Admin
      const admins = await tx.user.findMany({ where: { role: 'ADMIN' } });
      for (const admin of admins) {
        await this.notificationService.createInTx(tx, {
          userId: admin.id,
          content: `Sengketa baru dibuka pada order #${orderId.substring(0, 8)}.`,
          link: `/admin/disputes/${dispute.id}`,
          type: 'DISPUTE',
        });
      }

      return dispute;
    });
  }

  /**
   * [User] Mendapatkan detail sengketa (termasuk pesan)
   */
  async getDisputeDetails(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        order: {
          include: { service: { select: { sellerId: true } } },
        },
        messages: {
          // Ambil semua pesan
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                profilePicture: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundException('Sengketa tidak ditemukan');
    }

    // Validasi akses (buyer, seller, atau admin - admin cek di service-nya)
    const isBuyer = dispute.order.buyerId === userId;
    const isSeller = dispute.order.service.sellerId === userId;

    if (!isBuyer && !isSeller) {
      // Nanti kita akan tambahkan cek role admin di sini jika perlu
      throw new ForbiddenException('Anda tidak memiliki akses ke sengketa ini');
    }

    return dispute;
  }

  /**
   * [User] Menambahkan pesan ke sengketa
   */
  async addMessage(
    userId: string,
    disputeId: string,
    dto: AddDisputeMessageDto,
  ) {
    // Validasi kepemilikan
    const dispute = await this.getDisputeDetails(userId, disputeId);

    if (dispute.status !== 'OPEN') {
      throw new BadRequestException('Sengketa ini sudah ditutup');
    }

    const message = await this.prisma.disputeMessage.create({
      data: {
        disputeId,
        senderId: userId,
        content: dto.content,
        attachments: dto.attachments,
      },
    });

    // Buat notifikasi untuk SEMUA pihak lain (termasuk admin)
    const participants = new Set<string>();
    participants.add(dispute.order.buyerId);
    participants.add(dispute.order.service.sellerId);
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    admins.forEach((admin) => participants.add(admin.id));

    // Hapus si pengirim pesan
    participants.delete(userId);

    // Kirim notif ke semua partisipan lain
    for (const participantId of participants) {
      await this.notificationService.create({
        userId: participantId,
        content: `Pesan baru di sengketa pesanan #${dispute.order.id.substring(0, 8)}.`,
        link: `/orders/${dispute.order.id}/dispute`,
        type: 'DISPUTE',
      });
    }

    return message;
  }
}