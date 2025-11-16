import { z } from 'zod';

export const AddDisputeMessageSchema = z.object({
  content: z
    .string()
    .min(1, { message: 'Pesan tidak boleh kosong' })
    .max(2000, { message: 'Pesan maksimal 2000 karakter' }),

  attachments: z
    .array(z.string().url({ message: 'URL attachment tidak valid' }))
    .max(5, { message: 'Maksimal 5 file attachment' })
    .default([]),
});

export type AddDisputeMessageDto = z.infer<typeof AddDisputeMessageSchema>;