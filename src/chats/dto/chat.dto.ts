import { z } from 'zod';

// Untuk POST /api/chat (memulai obrolan baru)
export const CreateConversationSchema = z.object({
  recipientId: z.string().cuid({ message: 'ID penerima tidak valid' }),

  initialMessage: z
    .string()
    .min(1, { message: 'Pesan awal tidak boleh kosong' })
    .max(1000, { message: 'Pesan maksimal 1000 karakter' }),
});
export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

// Untuk WebSocket event 'sendMessage'
export const SendMessageSchema = z.object({
  conversationId: z.string().cuid({ message: 'ID obrolan tidak valid' }),

  content: z
    .string()
    .min(1, { message: 'Pesan tidak boleh kosong' })
    .max(2000, { message: 'Pesan maksimal 2000 karakter' }),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;