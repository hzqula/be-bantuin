import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { User } from '@prisma/client';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    // Guard ini berjalan SETELAH JwtAuthGuard (global),
    // jadi request.user dijamin ada.
    if (user && user.role === 'ADMIN') {
      return true;
    }

    throw new ForbiddenException('Akses ditolak. Hanya untuk administrator.');
  }
}