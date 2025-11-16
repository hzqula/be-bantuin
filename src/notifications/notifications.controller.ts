import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard) // Amankan semua endpoint
export class NotificationsController {
  constructor(
    // Kita inject PrismaService di sini untuk operasi 'baca'
    private prisma: PrismaService,
  ) {}

  /**
   * [User] Mendapatkan semua notifikasi (terbaru dulu)
   * GET /api/notifications
   */
  @Get()
  async getMyNotifications(@GetUser('id') userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50, // Batasi 50 terbaru
    });
    return {
      success: true,
      data: notifications,
    };
  }

  /**
   * [User] Mendapatkan jumlah notifikasi yang belum dibaca
   * GET /api/notifications/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(@GetUser('id') userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return {
      success: true,
      data: { count },
    };
  }

  /**
   * [User] Menandai satu notifikasi sebagai 'sudah dibaca'
   * POST /api/notifications/:id/read
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @GetUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId, // Pastikan user hanya bisa update notif miliknya
      },
      data: { isRead: true },
    });
    return {
      success: true,
      message: 'Notifikasi ditandai telah dibaca',
    };
  }

  /**
   * [User] Menandai semua notifikasi sebagai 'sudah dibaca'
   * POST /api/notifications/read-all
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@GetUser('id') userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return {
      success: true,
      message: 'Semua notifikasi ditandai telah dibaca',
    };
  }
}