import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  GoogleUserDto,
  AuthResponseDto,
  JwtPayload,
} from './dto/google-auth.dto';
import { User } from '@prisma/client';
import { WalletsService } from 'src/wallets/wallets.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private walletService: WalletsService,
  ) {}

  async googleLogin(googleUser: GoogleUserDto): Promise<AuthResponseDto> {
    const { email, fullName, nim, major, batch, picture, googleId } =
      googleUser;

    // Cari atau buat user
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Buat user baru jika belum ada
      user = await this.prisma.user.create({
        data: {
          email,
          fullName,
          googleId,
          nim,
          major,
          batch,
          profilePicture: picture,
          provider: 'google',
          isVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      // BUATKAN WALLET UNTUK USER BARU
      await this.walletService.createWallet(user.id);
    } else {
      // Update googleId jika user sudah ada tapi belum punya googleId
      if (!user.googleId) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            isVerified: true,
            emailVerifiedAt: user.emailVerifiedAt || new Date(),
          },
        });
      }
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    // Generate JWT token
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        profilePicture: user.profilePicture,
        isSeller: user.isSeller,
        isVerified: user.isVerified,
        major: user.major,
        nim: user.nim,
      },
    };
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: userId, status: 'active' },
    });
  }

  /**
   * [BARU] Metode untuk memvalidasi user dari token JWT penuh
   * Digunakan oleh WebSocket Gateway
   */
  async validateUserFromJwt(token: string): Promise<User> {
    try {
      const payload: JwtPayload = this.jwtService.verify(token);
      if (!payload || !payload.sub) {
        throw new UnauthorizedException('Invalid token payload');
      }
      const user = await this.validateUser(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found or inactive');
      }
      return user;
    } catch (error) {
      throw new UnauthorizedException(
        `Token validation failed: ${error.message}`,
      );
    }
  }
}