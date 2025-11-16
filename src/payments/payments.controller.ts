import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Webhook payment callback dari Midtrans
   * Endpoint ini HARUS public
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async paymentWebhook(@Body() payload: any) {
    // Biarkan PaymentsService memvalidasi, memproses, DAN memancarkan event
    const result = await this.paymentsService.handlePaymentWebhook(payload);

    return { success: true, message: result.message || 'Webhook processed' };
  }
}