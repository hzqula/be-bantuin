import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type {
  CreateOrderDto,
  DeliverOrderDto,
  RequestRevisionDto,
  OrderFilterDto,
  CancelOrderDto,
} from './dto/order.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Buat order baru
   * POST /api/orders
   *
   * Buyer membuat order untuk sebuah service
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @GetUser('id') buyerId: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    const order = await this.ordersService.create(buyerId, createOrderDto);

    return {
      success: true,
      message:
        'Order berhasil dibuat. Silakan konfirmasi untuk melanjutkan pembayaran.',
      data: order,
    };
  }

  /**
   * Konfirmasi order dan generate payment link
   * POST /api/orders/:id/confirm
   *
   * Buyer mengonfirmasi order yang masih draft
   * Status berubah dari DRAFT -> WAITING_PAYMENT
   */
  @Post(':id/confirm')
  async confirmOrder(
    @Param('id') orderId: string,
    @GetUser('id') buyerId: string,
  ) {
    const result = await this.ordersService.confirmOrder(orderId, buyerId);

    return {
      success: true,
      message: result.message,
      data: result.order,
      paymentToken: result.paymentToken, // Kirim Snap Token ke frontend
      paymentRedirectUrl: result.paymentRedirectUrl, // Kirim redirect URL ke frontend
    };
  }

  /**
   * Seller memulai pengerjaan
   * POST /api/orders/:id/start
   *
   * Mengubah status dari PAID_ESCROW -> IN_PROGRESS
   */
  @Post(':id/start')
  async startWork(
    @Param('id') orderId: string,
    @GetUser('id') sellerId: string,
  ) {
    const order = await this.ordersService.startWork(orderId, sellerId);

    return {
      success: true,
      message: 'Pengerjaan dimulai. Semangat!',
      data: order,
    };
  }

  /**
   * Seller mengirimkan hasil kerja
   * POST /api/orders/:id/deliver
   *
   * Mengubah status dari IN_PROGRESS atau REVISION -> DELIVERED
   */
  @Post(':id/deliver')
  async deliverWork(
    @Param('id') orderId: string,
    @GetUser('id') sellerId: string,
    @Body() deliverDto: DeliverOrderDto,
  ) {
    const order = await this.ordersService.deliverWork(
      orderId,
      sellerId,
      deliverDto,
    );

    return {
      success: true,
      message: 'Hasil kerja berhasil dikirim. Menunggu persetujuan buyer.',
      data: order,
    };
  }

  /**
   * Buyer meminta revisi
   * POST /api/orders/:id/revision
   *
   * Mengubah status dari DELIVERED -> REVISION
   */
  @Post(':id/revision')
  async requestRevision(
    @Param('id') orderId: string,
    @GetUser('id') buyerId: string,
    @Body() revisionDto: RequestRevisionDto,
  ) {
    const order = await this.ordersService.requestRevision(
      orderId,
      buyerId,
      revisionDto,
    );

    return {
      success: true,
      message: 'Permintaan revisi berhasil dikirim.',
      data: order,
    };
  }

  /**
   * Buyer menyetujui hasil kerja
   * POST /api/orders/:id/approve
   *
   * Ini adalah endpoint paling kritis:
   * - Mengubah status menjadi COMPLETED
   * - Melepas escrow ke seller
   * - Memungkinkan review
   */
  @Post(':id/approve')
  async approveWork(
    @Param('id') orderId: string,
    @GetUser('id') buyerId: string,
  ) {
    const order = await this.ordersService.approveWork(orderId, buyerId);

    return {
      success: true,
      message:
        'Pesanan selesai! Dana telah diteruskan ke penyedia jasa. Jangan lupa berikan review.',
      data: order,
    };
  }

  /**
   * Buyer membatalkan order
   * POST /api/orders/:id/cancel/buyer
   *
   * Buyer bisa cancel jika status masih DRAFT atau WAITING_PAYMENT
   */
  @Post(':id/cancel/buyer')
  async cancelByBuyer(
    @Param('id') orderId: string,
    @GetUser('id') buyerId: string,
    @Body() cancelDto: CancelOrderDto,
  ) {
    const result = await this.ordersService.cancelOrder(
      orderId,
      buyerId,
      'buyer',
      cancelDto,
    );

    return {
      success: true,
      message: result.refunded
        ? 'Order dibatalkan dan dana akan dikembalikan'
        : 'Order dibatalkan',
      data: result,
    };
  }

  /**
   * Seller membatalkan order
   * POST /api/orders/:id/cancel/seller
   *
   * Seller bisa cancel dengan alasan valid
   */
  @Post(':id/cancel/seller')
  async cancelBySeller(
    @Param('id') orderId: string,
    @GetUser('id') sellerId: string,
    @Body() cancelDto: CancelOrderDto,
  ) {
    const result = await this.ordersService.cancelOrder(
      orderId,
      sellerId,
      'seller',
      cancelDto,
    );

    return {
      success: true,
      message: 'Order dibatalkan dan dana akan dikembalikan ke buyer',
      data: result,
    };
  }

  /**
   * Get all orders
   * GET /api/orders
   *
   * Support filtering by role (buyer/worker), status, search, dll
   */
  @Get()
  async findAll(
    @GetUser('id') userId: string,
    @Query() filters: OrderFilterDto,
  ) {
    const result = await this.ordersService.findAll(userId, filters);

    return {
      success: true,
      data: result.data,
      pagination: result.pagination,
    };
  }

  /**
   * Get order detail
   * GET /api/orders/:id
   *
   * Hanya buyer atau seller yang terkait yang bisa akses
   */
  @Get(':id')
  async findOne(@Param('id') orderId: string, @GetUser('id') userId: string) {
    const order = await this.ordersService.findOne(orderId, userId);

    return {
      success: true,
      data: order,
    };
  }
}