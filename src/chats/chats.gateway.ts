import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { AuthService } from '../auth/auth.service'; // Untuk validasi token
import { NotificationsService } from 'src/notifications/notifications.service';
import type { SendMessageDto } from './dto/chat.dto';

// Autentikasi user dari socket
async function authenticateSocket(
  socket: Socket,
  authService: AuthService,
): Promise<any> {
  // Mengembalikan User
  const token = socket.handshake.auth.token;
  if (!token) {
    throw new Error('Authentication failed: No token provided');
  }
  try {
    const user = await authService.validateUser(token.sub); // Ganti ini ke validasi JWT
    if (!user) {
      throw new Error('Authentication failed: Invalid user');
    }
    return user; // Sukses
  } catch (err) {
    throw new Error(`Authentication failed: ${err.message}`);
  }
}

@WebSocketGateway({
  cors: {
    origin: '*', // Ganti dengan FRONTEND_URL Anda di production
  },
})
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<string, Socket> = new Map();

  constructor(
    private chatService: ChatsService,
    private authService: AuthService,
    private notificationService: NotificationsService,
  ) {}

  /**
   * Handle koneksi baru
   */
  async handleConnection(client: Socket) {
    try {
      // 1. Autentikasi user dari token
      const token = client.handshake.auth.token;
      if (!token) throw new Error('No token provided');

      // 2. Gunakan AuthService untuk validasi JWT
      // Ini jauh lebih clean dan terenkapsulasi
      const user = await this.authService.validateUserFromJwt(token);

      // 3. Simpan data user di socket
      client.data.user = user;
      this.connectedUsers.set(user.id, client);
      console.log(`Client connected: ${user.id}`);

      // 4. [Best Practice] Join 'room' pribadi user
      // Ini memungkinkan kita mengirim notif ke userId
      client.join(user.id);
    } catch (error) {
      console.error('Socket Auth Failed:', error.message);
      client.disconnect(true);
    }
  }

  /**
   * Handle diskoneksi
   */
  handleDisconnect(client: Socket) {
    if (client.data.user) {
      this.connectedUsers.delete(client.data.user.id);
      console.log(`Client disconnected: ${client.data.user.id}`);
    }
  }

  /**
   * [Event] User mengirim pesan
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const sender = client.data.user;

    // 1. Simpan pesan ke DB
    const message = await this.chatService.saveMessage(sender.id, dto);

    // 2. Broadcast ke penerima (jika online)
    const recipientIds = await this.chatService.getRecipientIds(
      dto.conversationId,
      sender.id,
    );

    for (const id of recipientIds) {
      const recipientSocket = this.connectedUsers.get(id);
      if (recipientSocket) {
        // Online: Kirim via WebSocket
        recipientSocket.emit('newMessage', message);
      } else {
        // Offline: Kirim via Notifikasi (Menyelesaikan TODO)
        await this.notificationService.create({
          userId: id,
          content: `Pesan baru dari ${sender.fullName}: "${message.content.substring(0, 30)}..."`,
          link: `/chat/${dto.conversationId}`,
          type: 'CHAT',
        });
      }
    }

    // 3. Kirim kembali ke pengirim (untuk konfirmasi)
    client.emit('newMessage', message);
  }

  /**
   * [Event] User meminta riwayat pesan
   */
  @SubscribeMessage('getHistory')
  async handleGetHistory(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user.id;
    const history = await this.chatService.getMessageHistory(
      userId,
      conversationId,
    );
    client.emit('messageHistory', history); // Kirim balik ke peminta
  }
}