import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { ActivateSellerDto } from './dto/activate-seller.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@GetUser('id') userId: string) {
    const user = await this.usersService.findById(userId);
    return {
      success: true,
      data: user,
    };
  }

  @Post('activate-seller')
  @HttpCode(HttpStatus.OK)
  async activateSeller(
    @GetUser('id') userId: string,
    @Body() dto: ActivateSellerDto,
  ) {
    const user = await this.usersService.activateSeller(
      userId,
      dto.phoneNumber,
      dto.bio,
    );
    return {
      success: true,
      message: 'Berhasil menjadi penyedia jasa',
      data: user,
    };
  }

  @Get('seller/stats')
  async getSellerStats(@GetUser('id') userId: string) {
    const stats = await this.usersService.getSellerStats(userId);
    return {
      success: true,
      data: stats,
    };
  }
}