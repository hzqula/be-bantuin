import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import type {
  InitiatePaymentDto,
  MidtransWebhookDto,
  WithdrawRequestDto,
  RefundRequestDto,
} from './dto/payment.dto';
import type {
  CreatePaymentResponse,
  InitiatePaymentResponse,
  WebhookValidationResult,
  PaymentStatus,
} from './type/payment.type';
import { mapMidtransStatus, PAYMENT_CONSTANTS } from './type/payment.type';

/**
 * PaymentsService
 * 
 * Service ini menangani semua aspek pembayaran:
 * 1. Integrasi dengan Midtrans untuk payment processing
 * 2. Escrow management (hold dan release dana)
 * 3. Webhook handling untuk payment notifications
 * 4. Refund processing
 * 5. Withdraw processing untuk seller
 * 
 * Design principles:
 * - Idempotency: Semua operasi payment harus idempotent
 * - Audit trail: Semua transaksi tercatat lengkap
 * - Security: Signature validation untuk webhook
 * - Atomicity: Database transactions untuk operasi kritis
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly midtransServerKey: string;
  private readonly midtransClientKey: string;
  private readonly midtransIsProduction: boolean;
  private readonly midtransApiUrl: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Load Midtrans configuration from environment variables
    this.midtransServerKey = this.configService.get<string>('MIDTRANS_SERVER_KEY') || '';
    this.midtransClientKey = this.configService.get<string>('MIDTRANS_CLIENT_KEY') || '';
    this.midtransIsProduction = this.configService.get<string>('NODE_ENV') === 'production';
    
    // Midtrans API URL berbeda untuk sandbox dan production
    this.midtransApiUrl = this.midtransIsProduction
      ? 'https://app.midtrans.com/snap/v1'
      : 'https://app.sandbox.midtrans.com/snap/v1';

    // Log warning jika credentials belum diset (untuk development)
    if (!this.midtransServerKey || !this.midtransClientKey) {
      this.logger.warn(
        'Midtrans credentials not configured. Payment features will not work. ' +
        'Please set MIDTRANS_SERVER_KEY and MIDTRANS_CLIENT_KEY in environment variables.'
      );
    }
  }

  /**
   * Initiate payment untuk sebuah order
   * 
   * Flow:
   * 1. Validate order exists dan statusnya WAITING_PAYMENT
   * 2. Create payment record di database
   * 3. Call Midtrans API untuk generate payment token
   * 4. Return payment URL untuk redirect user
   * 
   * @param dto - Data untuk initiate payment
   * @param userId - ID user yang melakukan pembayaran (untuk validation)
   * @returns Payment token dan URL
   */
  async initiatePayment(
    dto: InitiatePaymentDto,
    userId: string,
  ): Promise<InitiatePaymentResponse> {
    // Fetch order dengan detail lengkap
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phoneNumber: true,
          },
        },
        service: {
          select: {
            title: true,
            category: true,
          },
        },
      },
    });

    // Validasi order
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.buyerId !== userId) {
      throw new BadRequestException('Anda tidak memiliki akses ke order ini');
    }

    if (order.status !== 'waiting_payment') {
      throw new BadRequestException(
        'Order tidak dalam status menunggu pembayaran. ' +
        `Status saat ini: ${order.status}`
      );
    }

    if (order.isPaid) {
      throw new BadRequestException('Order sudah dibayar sebelumnya');
    }

    // Validasi amount
    const amount = Number(order.price);
    if (amount < PAYMENT_CONSTANTS.MIN_TRANSACTION_AMOUNT) {
      throw new BadRequestException(
        `Jumlah pembayaran minimal Rp ${PAYMENT_CONSTANTS.MIN_TRANSACTION_AMOUNT.toLocaleString()}`
      );
    }

    if (amount > PAYMENT_CONSTANTS.MAX_TRANSACTION_AMOUNT) {
      throw new BadRequestException(
        `Jumlah pembayaran maksimal Rp ${PAYMENT_CONSTANTS.MAX_TRANSACTION_AMOUNT.toLocaleString()}`
      );
    }

    // Generate unique transaction ID
    // Format: BANTUIN-{ORDER_ID_PREFIX}-{TIMESTAMP}
    const transactionId = `BANTUIN-${order.id.slice(0, 8)}-${Date.now()}`;

    try {
      // Create payment request untuk Midtrans
      const midtransPayload = {
        transaction_details: {
          order_id: transactionId,
          gross_amount: amount,
        },
        customer_details: {
          first_name: order.buyer.fullName,
          email: order.buyer.email,
          phone: order.buyer.phoneNumber || '',
        },
        item_details: [
          {
            id: order.serviceId,
            name: order.title,
            price: amount,
            quantity: 1,
            category: order.service.category,
          },
        ],
        callbacks: {
          finish: `${this.configService.get('FRONTEND_URL')}/orders/${order.id}?payment=success`,
          error: `${this.configService.get('FRONTEND_URL')}/orders/${order.id}?payment=error`,
          pending: `${this.configService.get('FRONTEND_URL')}/orders/${order.id}?payment=pending`,
        },
        expiry: {
          unit: 'minutes',
          duration: PAYMENT_CONSTANTS.PAYMENT_EXPIRY_MINUTES,
        },
      };

      // Call Midtrans API
      const midtransResponse = await this.callMidtransApi(midtransPayload);

      // Calculate expiry time
      const expiryTime = new Date();
      expiryTime.setMinutes(
        expiryTime.getMinutes() + PAYMENT_CONSTANTS.PAYMENT_EXPIRY_MINUTES
      );

      // Simpan payment record di database
      // Gunakan upsert untuk idempotency (kalau user click "bayar" berkali-kali)
      const payment = await this.prisma.$transaction(async (tx) => {
        // Cek apakah sudah ada payment record untuk order ini
        const existingPayment = await tx.payment.findFirst({
          where: {
            orderId: order.id,
            status: { in: ['pending', 'settlement', 'success'] },
          },
        });

        if (existingPayment) {
          // Jika ada payment yang masih pending atau success, return existing
          this.logger.log(
            `Payment already exists for order ${order.id}. Returning existing payment.`
          );
          return existingPayment;
        }

        // Create new payment record
        return await tx.payment.create({
          data: {
            orderId: order.id,
            transactionId,
            provider: 'midtrans',
            providerRef: midtransResponse.token,
            paymentMethod: dto.paymentMethod || 'bank_transfer',
            status: 'pending',
            amount,
            paidAmount: 0,
            currency: PAYMENT_CONSTANTS.CURRENCY,
            metadata: {
              snapToken: midtransResponse.token,
              snapUrl: midtransResponse.redirectUrl,
              expiryTime: expiryTime.toISOString(),
            },
          },
        });
      });

      this.logger.log(
        `Payment initiated for order ${order.id}. Transaction ID: ${transactionId}`
      );

      // Return response dengan payment details
      return {
        success: true,
        message: 'Payment berhasil dibuat. Silakan selesaikan pembayaran.',
        data: {
          orderId: order.id,
          paymentToken: midtransResponse.token,
          paymentUrl: midtransResponse.redirectUrl,
          amount,
          expiryTime,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to initiate payment for order ${order.id}`,
        error instanceof Error ? error.stack : 'Unknown error'
      );

      throw new InternalServerErrorException(
        'Gagal membuat pembayaran. Silakan coba lagi.'
      );
    }
  }

  /**
   * Handle webhook notification dari Midtrans
   * 
   * Ini adalah endpoint paling kritis dalam payment flow.
   * Midtrans akan memanggil endpoint ini setiap kali ada update status pembayaran.
   * 
   * Security measures:
   * 1. Validate signature untuk memastikan request benar dari Midtrans
   * 2. Idempotency check untuk mencegah duplicate processing
   * 3. Database transaction untuk atomicity
   * 
   * @param notification - Data notification dari Midtrans
   * @returns Validation result
   */
  async handleWebhook(
    notification: MidtransWebhookDto
  ): Promise<WebhookValidationResult> {
    try {
      // Step 1: Validate signature
      const isValid = this.validateSignature(
        notification.order_id,
        notification.status_code,
        notification.gross_amount,
        notification.signature_key
      );

      if (!isValid) {
        this.logger.error(
          `Invalid signature for webhook. Order ID: ${notification.order_id}`
        );
        return {
          isValid: false,
          transactionStatus: null,
          orderId: null,
          amount: null,
          error: 'Invalid signature',
        };
      }

      // Step 2: Parse data
      const transactionId = notification.order_id;
      const amount = parseFloat(notification.gross_amount);
      const paymentStatus = mapMidtransStatus(
        notification.transaction_status,
        notification.fraud_status
      );

      this.logger.log(
        `Webhook received for transaction ${transactionId}. ` +
        `Status: ${paymentStatus}, Amount: ${amount}`
      );

      // Step 3: Find payment dan order
      const payment = await this.prisma.payment.findFirst({
        where: { transactionId },
        include: { order: true },
      });

      if (!payment) {
        this.logger.error(`Payment not found for transaction ${transactionId}`);
        return {
          isValid: false,
          transactionStatus: null,
          orderId: null,
          amount: null,
          error: 'Payment not found',
        };
      }

      // Step 4: Idempotency check
      // Jika payment sudah di-process dengan status final, skip
      const finalStatuses: PaymentStatus[] = ['settlement', 'success', 'refund', 'failed', 'expired'];
      if (finalStatuses.includes(payment.status as PaymentStatus)) {
        this.logger.log(
          `Payment ${payment.id} already processed with status ${payment.status}. Skipping.`
        );
        return {
          isValid: true,
          transactionStatus: payment.status as PaymentStatus,
          orderId: payment.orderId,
          amount: payment.amount,
        };
      }

      // Step 5: Process payment based on status
      await this.processPaymentStatus(payment.id, payment.orderId, paymentStatus, amount);

      return {
        isValid: true,
        transactionStatus: paymentStatus,
        orderId: payment.orderId,
        amount,
      };
    } catch (error) {
      this.logger.error(
        'Failed to process webhook',
        error instanceof Error ? error.stack : 'Unknown error'
      );

      return {
        isValid: false,
        transactionStatus: null,
        orderId: null,
        amount: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process payment status change
   * 
   * Ini adalah core logic yang menangani perubahan status pembayaran
   * dan melakukan actions yang sesuai (update order, create escrow, dll)
   * 
   * @param paymentId - ID payment record
   * @param orderId - ID order
   * @param status - Status baru dari payment
   * @param paidAmount - Jumlah yang dibayar
   */
  private async processPaymentStatus(
    paymentId: string,
    orderId: string,
    status: PaymentStatus,
    paidAmount: number
  ): Promise<void> {
    // Gunakan transaction untuk memastikan atomicity
    await this.prisma.$transaction(async (tx) => {
      // Update payment status
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status,
          paidAmount,
          updatedAt: new Date(),
        },
      });

      // Actions based on status
      if (status === 'settlement' || status === 'success') {
        // Payment success - Create escrow hold
        await this.handlePaymentSuccess(tx, orderId, paidAmount);
      } else if (status === 'failed' || status === 'expired') {
        // Payment failed - Update order status back
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancellationReason: `Payment ${status}`,
          },
        });
      }
      // For 'pending' status, we just update payment record (already done above)
    });

    this.logger.log(
      `Payment ${paymentId} processed successfully. Status: ${status}`
    );
  }

  /**
   * Handle successful payment
   * 
   * Ketika payment sukses:
   * 1. Update order status ke PAID_ESCROW
   * 2. Create escrow hold record (dana ditahan)
   * 3. Update seller wallet (balance tidak berubah, tapi ada pending escrow)
   * 
   * @param tx - Prisma transaction client
   * @param orderId - ID order yang dibayar
   * @param amount - Jumlah pembayaran
   */
  private async handlePaymentSuccess(
    tx: any,
    orderId: string,
    amount: number
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        service: {
          select: { sellerId: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Update order status
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'paid_escrow',
        isPaid: true,
        paidAt: new Date(),
      },
    });

    // Get or create seller wallet
    const sellerWallet = await tx.wallet.upsert({
      where: { userId: order.service.sellerId },
      create: {
        userId: order.service.sellerId,
        balance: 0,
      },
      update: {},
    });

    // Create escrow hold transaction
    // Amount negative karena ini adalah "hold" (dana belum masuk wallet)
    await tx.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        type: 'ESCROW_HOLD',
        amount: -amount, // Negative untuk indicate hold
        refOrderId: orderId,
        description: `Escrow hold untuk order ${order.title}`,
        metadata: {
          orderTitle: order.title,
          holdAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(
      `Escrow created for order ${orderId}. Amount: ${amount}. ` +
      `Seller wallet: ${sellerWallet.id}`
    );

    // TODO: Send notification ke buyer (payment success)
    // TODO: Send notification ke seller (new order paid)
  }

  /**
   * Release escrow ke seller
   * 
   * Dipanggil ketika buyer approve hasil kerja.
   * Dana yang ditahan di escrow dilepas dan masuk ke wallet seller.
   * 
   * @param orderId - ID order yang completed
   */
  async releaseEscrow(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        service: {
          select: { sellerId: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'completed') {
      throw new BadRequestException(
        'Escrow hanya bisa dilepas untuk order yang completed'
      );
    }

    // Check if escrow already released
    const existingRelease = await this.prisma.walletTransaction.findFirst({
      where: {
        refOrderId: orderId,
        type: 'ESCROW_RELEASE',
      },
    });

    if (existingRelease) {
      this.logger.log(`Escrow already released for order ${orderId}. Skipping.`);
      return;
    }

    const amount = Number(order.price);
    const platformFee = Math.round(
      (amount * PAYMENT_CONSTANTS.PLATFORM_FEE_PERCENTAGE) / 100
    );
    const sellerAmount = amount - platformFee;

    await this.prisma.$transaction(async (tx) => {
      // Get seller wallet
      const sellerWallet = await tx.wallet.findUnique({
        where: { userId: order.service.sellerId },
      });

      if (!sellerWallet) {
        throw new InternalServerErrorException('Seller wallet not found');
      }

      // Release escrow - update wallet balance
      await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: {
          balance: {
            increment: sellerAmount,
          },
        },
      });

      // Create release transaction
      await tx.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          type: 'ESCROW_RELEASE',
          amount: sellerAmount, // Positive karena masuk ke wallet
          refOrderId: orderId,
          description: `Escrow release untuk order ${order.title}`,
          metadata: {
            orderTitle: order.title,
            grossAmount: amount,
            platformFee,
            netAmount: sellerAmount,
            releasedAt: new Date().toISOString(),
          },
        },
      });

      // Record platform fee
      // Platform fee tidak masuk ke wallet manapun,
      // tapi dicatat untuk accounting
      await tx.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          type: 'PLATFORM_FEE',
          amount: -platformFee,
          refOrderId: orderId,
          description: `Platform fee ${PAYMENT_CONSTANTS.PLATFORM_FEE_PERCENTAGE}% dari order ${order.title}`,
          metadata: {
            feePercentage: PAYMENT_CONSTANTS.PLATFORM_FEE_PERCENTAGE,
            grossAmount: amount,
            feeAmount: platformFee,
          },
        },
      });
    });

    this.logger.log(
      `Escrow released for order ${orderId}. ` +
      `Gross: ${amount}, Fee: ${platformFee}, Net: ${sellerAmount}`
    );

    // TODO: Send notification ke seller (payment received)
  }

  /**
   * Validate Midtrans signature
   * 
   * Midtrans mengirim signature_key yang harus kita validate
   * untuk memastikan request benar-benar dari Midtrans
   * 
   * Signature formula:
   * SHA512(order_id + status_code + gross_amount + server_key)
   */
  private validateSignature(
    orderId: string,
    statusCode: string,
    grossAmount: string,
    signatureKey: string
  ): boolean {
    const hash = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${this.midtransServerKey}`)
      .digest('hex');

    return hash === signatureKey;
  }

  /**
   * Call Midtrans API untuk create transaction
   * 
   * @param payload - Transaction details
   * @returns Midtrans response dengan token dan redirect URL
   */
  private async callMidtransApi(payload: any): Promise<CreatePaymentResponse> {
    // Encode server key untuk Basic Auth
    const authString = Buffer.from(this.midtransServerKey + ':').toString('base64');

    try {
      const response = await fetch(`${this.midtransApiUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${authString}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Midtrans API error: ${error}`);
        throw new Error('Failed to create Midtrans transaction');
      }

      const data = await response.json();

      return {
        token: data.token,
        redirectUrl: data.redirect_url,
        transactionId: payload.transaction_details.order_id,
      };
    } catch (error) {
      this.logger.error(
        'Failed to call Midtrans API',
        error instanceof Error ? error.stack : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Get payment details untuk sebuah order
   * 
   * @param orderId - ID order
   * @param userId - ID user (untuk access control)
   * @returns Payment details
   */
  async getPaymentDetails(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [
          { buyerId: userId },
          { service: { sellerId: userId } },
        ],
      },
      include: {
        payment: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    return order.payment;
  }
}