import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Global() // <-- Jadikan Global
@Module({
  controllers: [NotificationsController], // Daftarkan Controller
  providers: [NotificationsService], // Daftarkan Service
  exports: [NotificationsService], // Ekspor Service
})

export class NotificationsModule {}