import { Module } from '@nestjs/common';
import { ChatsGateway } from './chats.gateway';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // Impor AuthModule untuk akses AuthService
  providers: [ChatsGateway, ChatsService],
  controllers: [ChatsController],
})

export class ChatsModule {}