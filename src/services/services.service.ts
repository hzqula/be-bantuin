import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ServiceFilterDto,
} from './dto/service.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new service listing
   * Only sellers can create services
   */
  async create(sellerId: string, dto: CreateServiceDto) {
    // Verify that user is a seller
    const user = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { isSeller: true, isVerified: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    if (!user.isSeller) {
      throw new ForbiddenException(
        'Anda harus menjadi penyedia jasa terlebih dahulu',
      );
    }

    if (!user.isVerified) {
      throw new BadRequestException('Akun Anda belum diverifikasi');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Akun Anda tidak aktif');
    }

    // Create the service
    const service = await this.prisma.service.create({
      data: {
        sellerId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        price: dto.price,
        deliveryTime: dto.deliveryTime,
        revisions: dto.revisions,
        images: dto.images || [],
        status: 'active',
        isActive: true,
      },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
            totalOrdersCompleted: true,
          },
        },
      },
    });

    return service;
  }

  /**
   * Get all services with filtering and pagination
   */
  async findAll(filters: ServiceFilterDto) {
    const {
      q,
      category,
      priceMin,
      priceMax,
      ratingMin,
      sellerId,
      page,
      limit,
      sortBy,
    } = filters;

    // Build where clause
    const where: Prisma.ServiceWhereInput = {
      isActive: true,
      status: 'active',
    };

    // Search query
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (category) {
      where.category = category;
    }

    // Price range
    if (priceMin !== undefined || priceMax !== undefined) {
      where.price = {};
      if (priceMin !== undefined) {
        where.price.gte = priceMin;
      }
      if (priceMax !== undefined) {
        where.price.lte = priceMax;
      }
    }

    // Rating filter
    if (ratingMin !== undefined) {
      where.avgRating = { gte: ratingMin };
    }

    // Seller filter
    if (sellerId) {
      where.sellerId = sellerId;
    }

    // Build orderBy clause
    let orderBy: Prisma.ServiceOrderByWithRelationInput = {};
    switch (sortBy) {
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'price_low':
        orderBy = { price: 'asc' };
        break;
      case 'price_high':
        orderBy = { price: 'desc' };
        break;
      case 'rating':
        orderBy = { avgRating: 'desc' };
        break;
      case 'popular':
        orderBy = { totalOrders: 'desc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Execute queries
    const [services, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          seller: {
            select: {
              id: true,
              fullName: true,
              profilePicture: true,
              major: true,
              batch: true,
              avgRating: true,
              totalReviews: true,
              totalOrdersCompleted: true,
            },
          },
        },
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      data: services,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single service by ID
   */
  async findOne(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            bio: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
            totalOrdersCompleted: true,
            createdAt: true,
          },
        },
        reviews: {
          where: {
            order: {
              status: 'completed',
            },
          },
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            author: {
              select: {
                id: true,
                fullName: true,
                profilePicture: true,
                major: true,
              },
            },
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    // Check if service is active
    if (!service.isActive || service.status !== 'active') {
      throw new NotFoundException('Jasa tidak tersedia');
    }

    return service;
  }

  /**
   * Update a service
   * Only the owner can update
   */
  async update(id: string, sellerId: string, dto: UpdateServiceDto) {
    // Check if service exists and belongs to seller
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Update service
    const updated = await this.prisma.service.update({
      where: { id },
      data: dto,
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Toggle service active status
   */
  async toggleActive(id: string, sellerId: string) {
    // Check ownership
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true, isActive: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Toggle active status
    const updated = await this.prisma.service.update({
      where: { id },
      data: { isActive: !service.isActive },
    });

    return updated;
  }

  /**
   * Delete a service (soft delete by setting status to 'deleted')
   */
  async remove(id: string, sellerId: string) {
    // Check ownership
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Check if there are active orders
    const activeOrders = await this.prisma.order.count({
      where: {
        serviceId: id,
        status: {
          in: ['pending', 'in_progress', 'delivered'],
        },
      },
    });

    if (activeOrders > 0) {
      throw new BadRequestException(
        'Tidak dapat menghapus jasa dengan pesanan yang masih aktif',
      );
    }

    // Soft delete
    await this.prisma.service.update({
      where: { id },
      data: {
        status: 'deleted',
        isActive: false,
      },
    });

    return { message: 'Jasa berhasil dihapus' };
  }

  /**
   * Get seller's services
   */
  async getSellerServices(sellerId: string) {
    const services = await this.prisma.service.findMany({
      where: {
        sellerId,
        status: { not: 'deleted' },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            orders: true,
          },
        },
      },
    });

    return services;
  }
}
