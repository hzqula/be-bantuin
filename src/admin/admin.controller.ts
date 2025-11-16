import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard'; 
import type { RejectPayoutDto } from './dto/reject-payout.dto';
import type { ResolveDisputeDto } from 'src/disputes/dto/resolve-dispute.dto'; 
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard) // Terapkan JwtAuthGuard dan AdminGuard
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Mendapatkan semua PayoutRequest yang pending
   * GET /api/admin/payouts/pending
   */
  @Get('payouts/pending')
  async getPendingPayouts() {
    const payouts = await this.adminService.getPendingPayouts();
    return {
      success: true,
      data: payouts,
    };
  }

  /**
   * Menyetujui PayoutRequest
   * POST /api/admin/payouts/:id/approve
   */
  @Post('payouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approvePayout(@Param('id') payoutId: string) {
    const payout = await this.adminService.approvePayout(payoutId);
    return {
      success: true,
      message: 'Permintaan penarikan berhasil disetujui',
      data: payout,
    };
  }

  /**
   * Menolak PayoutRequest
   * POST /api/admin/payouts/:id/reject
   */
  @Post('payouts/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectPayout(
    @Param('id') payoutId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    const payout = await this.adminService.rejectPayout(payoutId, dto.reason);
    return {
      success: true,
      message: 'Permintaan penarikan ditolak. Dana telah dikembalikan ke user.',
      data: payout,
    };
  }

  // --- Endpoint Manajemen Sengketa ---

  /**
   * [Admin] Mendapatkan semua sengketa yang 'OPEN'
   * GET /api/admin/disputes/open
   */
  @Get('disputes/open')
  async getOpenDisputes() {
    const disputes = await this.adminService.getOpenDisputes();
    return {
      success: true,
      data: disputes,
    };
  }

  /**
   * [Admin] Menyelesaikan sengketa
   * POST /api/admin/disputes/:disputeId/resolve
   */
  @Post('disputes/:disputeId/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveDispute(
    @GetUser('id') adminId: string,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    const dispute = await this.adminService.resolveDispute(
      adminId,
      disputeId,
      dto,
    );
    return {
      success: true,
      message: `Sengketa berhasil diselesaikan dengan hasil: ${dto.resolution}`,
      data: dispute,
    };
  }
}