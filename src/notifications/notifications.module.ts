import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConfigModule } from '@nestjs/config'; 

@Global() 
@Module({
  imports: [
    ConfigModule, 
  ],
  controllers: [NotificationsController], 
  providers: [NotificationsService], 
  exports: [NotificationsService], 
})
export class NotificationsModule {}