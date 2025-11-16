import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateConversationDto } from './dto/chat.dto';
import type { SendMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  /**
   * [REST] Mendapatkan atau Membuat Obrolan Baru
   */
  async findOrCreateConversation(senderId: string, dto: CreateConversationDto) {
    const { recipientId, initialMessage } = dto;

    if (senderId === recipientId) {
      throw new BadRequestException(
        'Anda tidak dapat mengirim pesan ke diri sendiri',
      );
    }

    // Cek apakah obrolan antara 2 user ini sudah ada
    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: senderId } } },
          { participants: { some: { userId: recipientId } } },
        ],
      },
    });

    if (existingConversation) {
      // Obrolan sudah ada, kirim pesan awal ke sana
      const message = await this.saveMessage(senderId, {
        conversationId: existingConversation.id,
        content: initialMessage,
      });
      return { conversation: existingConversation, message, isNew: false };
    }

    // Buat obrolan baru jika belum ada
    return this.prisma.$transaction(async (tx) => {
      const newConversation = await tx.conversation.create({
        data: {},
      });

      // Tambahkan kedua peserta
      await tx.conversationParticipant.createMany({
        data: [
          { userId: senderId, conversationId: newConversation.id },
          { userId: recipientId, conversationId: newConversation.id },
        ],
      });

      // Simpan pesan awal
      const message = await this.saveMessageInTx(tx, senderId, {
        conversationId: newConversation.id,
        content: initialMessage,
      });

      // Update lastMessageId di Conversation
      await tx.conversation.update({
        where: { id: newConversation.id },
        data: { lastMessageId: message.id },
      });

      return { conversation: newConversation, message, isNew: true };
    });
  }

  /**
   * [WebSocket] Menyimpan pesan baru
   */
  async saveMessage(senderId: string, dto: SendMessageDto) {
    return this.prisma.$transaction(async (tx) => {
      return this.saveMessageInTx(tx, senderId, dto);
    });
  }

  /**
   * [Internal] Helper untuk menyimpan pesan di dalam transaksi
   */
  async saveMessageInTx(
    tx: any, // Prisma Transaction Client
    senderId: string,
    dto: SendMessageDto,
  ) {
    const { conversationId, content } = dto;

    // 1. Simpan pesan
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId,
        content,
      },
      include: {
        sender: {
          // Sertakan info pengirim untuk di-broadcast
          select: { id: true, fullName: true, profilePicture: true },
        },
      },
    });

    // 2. Update 'updatedAt' dan 'lastMessageId' di Conversation
    // Ini akan menaikkan obrolan ke atas di inbox
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        lastMessageId: message.id,
      },
    });

    return message;
  }

  /**
   * [REST] Mendapatkan semua obrolan (Inbox)
   */
  async getMyConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { updatedAt: 'desc' }, // Terbaru dulu
      include: {
        lastMessage: {
          // Ambil pesan terakhir
          include: {
            sender: { select: { fullName: true } },
          },
        },
        participants: {
          // Ambil info peserta lain
          where: { NOT: { userId } },
          include: {
            user: {
              select: { id: true, fullName: true, profilePicture: true },
            },
          },
        },
      },
    });
  }

  /**
   * [WebSocket] Mendapatkan riwayat pesan
   */
  async getMessageHistory(userId: string, conversationId: string) {
    // Validasi apakah user adalah peserta
    const isParticipant = await this.prisma.conversationParticipant.count({
      where: { userId, conversationId },
    });

    if (isParticipant === 0) {
      throw new ForbiddenException('Akses ditolak');
    }

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, fullName: true, profilePicture: true },
        },
      },
    });
  }

  /**
   * [Helper] Mendapatkan ID peserta lain dalam obrolan
   */
  async getRecipientIds(
    conversationId: string,
    senderId: string,
  ): Promise<string[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        NOT: { userId: senderId },
      },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }
}