import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PrismaClient } from '@prisma/client';

type NotificationData = {
  userId: string;
  content: string;
  link?: string;
  type?: string;
};

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Membuat notifikasi (standalone)
   */
  async create(data: NotificationData) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });
    } catch (error) {
      // Gagal membuat notifikasi seharusnya tidak menghentikan alur utama
      console.error('Failed to create notification:', error);
    }
  }

  /**
   * Membuat notifikasi di dalam transaksi Prisma yang sedang berjalan
   * Ini penting untuk keandalan data
   */
  async createInTx(tx: Tx, data: NotificationData) {
    try {
      await tx.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });
    } catch (error) {
      // Jika notifikasi gagal di dalam TX, seluruh TX akan gagal
      // Ini *mungkin* tidak diinginkan. Untuk sekarang, kita log saja.
      // Dalam produksi, Anda mungkin ingin me-log tapi tidak melempar error
      console.error('Error creating notification in TX:', error);
      // throw error; // Uncomment jika notifikasi WAJIB berhasil
    }
  }
}