import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
// PrismaModule dan WalletModule sudah Global,
// jadi tidak perlu di-import di sini.

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})

export class AdminModule {}