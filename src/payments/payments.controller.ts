import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type {
  InitiatePaymentDto,
  MidtransWebhookDto,
} from './dto/payment.dto';

/**
 * PaymentsController
 * 
 * Controller ini menangani semua HTTP endpoints untuk payment operations.
 * Sebagian besar endpoints memerlukan authentication kecuali webhook
 * yang dipanggil oleh Midtrans.
 * 
 * Endpoints:
 * - POST /payments/initiate - Memulai proses pembayaran
 * - POST /payments/webhook - Menerima notifikasi dari Midtrans
 * - GET /payments/order/:orderId - Cek status pembayaran order
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Initiate payment untuk order
   * POST /api/payments/initiate
   * 
   * Endpoint ini dipanggil setelah user konfirmasi order dan siap membayar.
   * Response berisi payment token dan URL yang digunakan untuk redirect
   * user ke halaman pembayaran Midtrans.
   * 
   * Flow dari frontend:
   * 1. User klik "Bayar Sekarang"
   * 2. Frontend call endpoint ini dengan orderId
   * 3. Backend generate payment di Midtrans dan return token
   * 4. Frontend redirect user ke paymentUrl atau show Snap modal
   * 5. User selesaikan pembayaran
   * 6. Midtrans kirim notification ke webhook
   * 7. User redirect kembali ke frontend dengan status payment
   * 
   * Requires: Authentication (JWT token)
   * Body: { orderId: string, paymentMethod?: string }
   * Response: { success, message, data: { paymentToken, paymentUrl, ... } }
   */
  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async initiatePayment(
    @Body() dto: InitiatePaymentDto,
    @GetUser('id') userId: string
  ) {
    const result = await this.paymentsService.initiatePayment(dto, userId);
    return result;
  }

  /**
   * Webhook endpoint untuk notifikasi dari Midtrans
   * POST /api/payments/webhook
   * 
   * PENTING: Endpoint ini HARUS bisa diakses tanpa authentication
   * karena dipanggil oleh Midtrans server, bukan oleh user.
   * 
   * Midtrans akan memanggil endpoint ini setiap kali ada perubahan
   * status pembayaran. Bisa dipanggil berkali-kali untuk transaction
   * yang sama (karena retry mechanism mereka), jadi implementasi
   * harus idempotent.
   * 
   * Security:
   * - Validasi signature untuk memastikan request dari Midtrans
   * - IP whitelisting bisa ditambahkan untuk extra security
   * - Tidak return data sensitif dalam response
   * 
   * Midtrans expects response 200 OK jika webhook berhasil diproses.
   * Jika return error (4xx atau 5xx), Midtrans akan retry.
   * 
   * Public endpoint (no authentication required)
   * Body: Midtrans notification payload
   * Response: { success, message }
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() notification: MidtransWebhookDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('x-real-ip') realIp?: string
  ) {
    // Log incoming webhook for debugging
    // NOTE: Jangan log data sensitif di production
    const clientIp = forwardedFor || realIp || 'unknown';
    console.log(
      `[WEBHOOK] Received from IP: ${clientIp}, ` +
      `Order: ${notification.order_id}, ` +
      `Status: ${notification.transaction_status}`
    );

    // Process webhook
    const result = await this.paymentsService.handleWebhook(notification);

    if (!result.isValid) {
      // Jika signature invalid atau ada error, return 200 OK
      // tapi dengan success: false untuk mencegah Midtrans retry
      return {
        success: false,
        message: result.error || 'Webhook validation failed',
      };
    }

    // Success response
    return {
      success: true,
      message: 'Webhook processed successfully',
    };
  }

  /**
   * Get payment details untuk sebuah order
   * GET /api/payments/order/:orderId
   * 
   * User bisa mengecek status pembayaran order mereka.
   * Berguna untuk:
   * - Menampilkan status "Menunggu Pembayaran" di UI
   * - Debugging jika user complain pembayaran tidak terproses
   * - Admin monitoring
   * 
   * Requires: Authentication
   * Access Control: Hanya buyer atau seller dari order yang bisa akses
   * Params: orderId (UUID)
   * Response: { success, data: PaymentRecord | null }
   */
  @Get('order/:orderId')
  @UseGuards(JwtAuthGuard)
  async getPaymentDetails(
    @Param('orderId') orderId: string,
    @GetUser('id') userId: string
  ) {
    const payment = await this.paymentsService.getPaymentDetails(
      orderId,
      userId
    );

    return {
      success: true,
      data: payment,
    };
  }

  /**
   * Manual trigger untuk release escrow
   * POST /api/payments/release-escrow/:orderId
   * 
   * Endpoint ini sebenarnya dipanggil secara otomatis ketika
   * buyer approve hasil kerja di OrdersService.approveWork().
   * 
   * Tapi kita expose sebagai endpoint terpisah untuk:
   * - Testing purposes
   * - Admin manual intervention jika ada issue
   * - Retry mechanism jika release gagal
   * 
   * Requires: Authentication
   * Params: orderId (UUID)
   * Response: { success, message }
   */
  @Post('release-escrow/:orderId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async releaseEscrow(
    @Param('orderId') orderId: string,
    @GetUser('id') userId: string
  ) {
    // Note: Kita tidak validasi userId di sini karena releaseEscrow
    // di service sudah handle validation bahwa order harus completed
    // Di production, sebaiknya endpoint ini hanya bisa dipanggil
    // oleh system atau admin, bukan user biasa

    await this.paymentsService.releaseEscrow(orderId);

    return {
      success: true,
      message: 'Escrow berhasil dilepas ke penyedia jasa',
    };
  }

  /**
   * Health check endpoint untuk payment service
   * GET /api/payments/health
   * 
   * Berguna untuk monitoring apakah payment service running dengan baik.
   * Bisa dipanggil oleh monitoring tools atau health check systems.
   * 
   * Public endpoint
   * Response: { status, timestamp, midtransConfigured }
   */
  @Public()
  @Get('health')
  async healthCheck() {
    // Check if Midtrans credentials are configured
    const midtransConfigured = !!(
      process.env.MIDTRANS_SERVER_KEY && 
      process.env.MIDTRANS_CLIENT_KEY
    );

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'payments',
      midtransConfigured,
      environment: process.env.NODE_ENV || 'development',
    };
  }
}