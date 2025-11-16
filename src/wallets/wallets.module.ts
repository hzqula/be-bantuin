import { Global, Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';

@Global() // Jadikan global agar tidak perlu import di setiap modul
@Module({
  providers: [WalletsService],
  controllers: [WalletsController],
  exports: [WalletsService],
})

export class WalletsModule {}