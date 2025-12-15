import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import type { RejectPayoutDto } from './dto/reject-payout.dto';
import type { RejectServiceDto } from './dto/reject-service.dto';
import type { ResolveDisputeDto } from '../disputes/dto/resolve-dispute.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard) // Terapkan JwtAuthGuard dan AdminGuard
export class AdminController {
  constructor(private readonly adminService: AdminService) { }

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
   * [Admin] Get services pending review
   * GET /api/admin/services/pending
   */
  @Get('services/pending')
  async getPendingServices() {
    const services = await this.adminService.getPendingServices();
    return { success: true, data: services };
  }

  /**
   * [Admin] Get service detail by ID
   * GET /api/admin/services/:id
   */
  @Get('services/:id')
  async getServiceById(@Param('id') id: string) {
    const service = await this.adminService.getServiceById(id);
    return { success: true, data: service };
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
   * [Admin] Approve a pending service
   * POST /api/admin/services/:id/approve
   */
  @Post('services/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveService(
    @GetUser('id') adminId: string,
    @Param('id') serviceId: string,
  ) {
    const svc = await this.adminService.approveService(adminId, serviceId);
    return { success: true, message: 'Jasa berhasil disetujui', data: svc };
  }

  /**
   * [Admin] Reject a pending service
   * POST /api/admin/services/:id/reject
   */
  @Post('services/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectService(
    @GetUser('id') adminId: string,
    @Param('id') serviceId: string,
    @Body() dto: RejectServiceDto,
  ) {
    const svc = await this.adminService.rejectService(
      adminId,
      serviceId,
      dto.reason,
    );
    return { success: true, message: 'Jasa berhasil ditolak', data: svc };
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

  /**
   * [Admin] Mendapatkan statistik dashboard
   * GET /api/admin/dashboard/stats
   */
  @Get('dashboard/stats')
  async getDashboardStats() {
    const stats = await this.adminService.getDashboardStats();
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * [Admin] Mendapatkan riwayat uang masuk (Escrow Release / Kredit)
   * GET /api/admin/dashboard/income-history
   */
  @Get('dashboard/income-history')
  async getIncomeHistory() {
    const history = await this.adminService.getIncomeHistory();
    return {
      success: true,
      data: history,
    };
  }

  @Get('users')
  async getAllUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('q') search?: string,
  ) {
    const result = await this.adminService.getAllUsers(
      Number(page) || 1,
      Number(limit) || 10,
      search || '',
    );
    return {
      success: true,
      data: result.data,
      pagination: result.pagination,
    };
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  async banUser(@Param('id') userId: string) {
    await this.adminService.banUser(userId);
    return {
      success: true,
      message: 'Pengguna berhasil diblokir (banned)',
    };
  }

  @Post('users/:id/unban')
  @HttpCode(HttpStatus.OK)
  async unbanUser(@Param('id') userId: string) {
    await this.adminService.unbanUser(userId);
    return {
      success: true,
      message: 'Pengguna berhasil diaktifkan kembali',
    };
  }
}
