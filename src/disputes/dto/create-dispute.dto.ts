import { z } from 'zod';

export const CreateDisputeSchema = z.object({
  reason: z
    .string()
    .min(50, { message: 'Alasan dispute minimal 50 karakter' })
    .max(2000, { message: 'Alasan dispute maksimal 2000 karakter' }),
});

export type CreateDisputeDto = z.infer<typeof CreateDisputeSchema>;