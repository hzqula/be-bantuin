import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    return user;
  }

  async findByEmail(email: string) {
    return await this.prisma.user.findUnique({
      where: { email },
    });
  }

  async activateSeller(userId: string, phoneNumber: string, bio: string) {
    // Check if user exists
    const user = await this.findById(userId);

    // Check if already a seller
    if (user.isSeller) {
      throw new ConflictException('Anda sudah terdaftar sebagai penyedia jasa');
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new BadRequestException(
        'Anda harus memverifikasi email terlebih dahulu',
      );
    }

    // Validate phone number length
    if (!phoneNumber || phoneNumber.length < 10) {
      throw new BadRequestException('Nomor telepon minimal 10 digit');
    }

    // Validate bio length
    if (!bio || bio.length < 50) {
      throw new BadRequestException('Bio minimal 50 karakter');
    }

    // Normalize phone number (convert to +62 format)
    let normalizedPhone = phoneNumber;
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '+62' + normalizedPhone.substring(1);
    } else if (normalizedPhone.startsWith('62')) {
      normalizedPhone = '+' + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+62')) {
      normalizedPhone = '+62' + normalizedPhone;
    }

    // Update user to become seller
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isSeller: true,
        phoneNumber: normalizedPhone,
        bio: bio,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updatedUser;
  }

  async updateProfile(userId: string, updateData: any) {
    // Verify user exists
    await this.findById(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updatedUser;
  }

  async getSellerStats(userId: string) {
    const user = await this.findById(userId);

    if (!user.isSeller) {
      throw new BadRequestException('User bukan penyedia jasa');
    }

    // Get seller services
    const services = await this.prisma.service.findMany({
      where: {
        sellerId: userId,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        price: true,
        totalOrders: true,
        avgRating: true,
        status: true,
      },
    });

    // Get orders as seller (through services)
    const serviceIds = services.map((s) => s.id);

    const [activeOrders, completedOrders, totalRevenue] = await Promise.all([
      // Active orders
      this.prisma.order.count({
        where: {
          serviceId: { in: serviceIds },
          status: { in: ['pending', 'in_progress', 'delivered'] },
        },
      }),
      // Completed orders
      this.prisma.order.count({
        where: {
          serviceId: { in: serviceIds },
          status: 'completed',
        },
      }),
      // Total revenue (completed orders only)
      this.prisma.order.aggregate({
        where: {
          serviceId: { in: serviceIds },
          status: 'completed',
        },
        _sum: {
          price: true,
        },
      }),
    ]);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        avgRating: user.avgRating,
        totalReviews: user.totalReviews,
        totalOrdersCompleted: user.totalOrdersCompleted,
      },
      stats: {
        totalServices: services.length,
        activeOrders,
        completedOrders,
        totalRevenue: totalRevenue._sum.price || 0,
      },
      services,
    };
  }
}