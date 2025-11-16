import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { GetUser } from './decorators/get-user.decorator';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(@Req() req: Request, @Res() res: Response) {
    try {
      const googleUser = req.user as any;

      const result = await this.authService.googleLogin({
        email: googleUser.email,
        fullName: googleUser.fullName,
        picture: googleUser.profilePicture,
        googleId: googleUser.googleId,
        nim: googleUser.nim,
        major: googleUser.major,
        batch: googleUser.batch,
      });

      // Redirect ke frontend dengan token
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const redirectUrl = `${frontendUrl}/auth/callback?token=${result.access_token}`;

      return res.redirect(redirectUrl);
    } catch (error) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const errorMessage =
        error instanceof Error ? error.message : 'Authentication failed';
      return res.redirect(
        `${frontendUrl}/auth/error?message=${encodeURIComponent(errorMessage)}`,
      );
    }
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@GetUser() user: User) {
    return {
      statusCode: 200,
      message: 'Profile retrieved successfully',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        nim: user.nim,
        major: user.major,
        batch: user.batch,
        phoneNumber: user.phoneNumber,
        profilePicture: user.profilePicture,
        bio: user.bio,
        isSeller: user.isSeller,
        isVerified: user.isVerified,
        avgRating: user.avgRating,
        totalReviews: user.totalReviews,
        totalOrdersCompleted: user.totalOrdersCompleted,
        createdAt: user.createdAt,
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@GetUser() user: User) {
    // Jika Anda menggunakan refresh token atau blacklist,
    // tambahkan logic di sini untuk invalidate token
    return {
      statusCode: 200,
      message: 'Logged out successfully',
    };
  }

  @Public()
  @Get('health')
  healthCheck() {
    return {
      statusCode: 200,
      message: 'Auth service is running',
      timestamp: new Date().toISOString(),
    };
  }
}