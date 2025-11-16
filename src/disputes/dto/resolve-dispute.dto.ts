import { z } from 'zod';

// Ambil enum dari Prisma (atau definisikan ulang)
export const ResolveDisputeSchema = z.object({
  resolution: z.enum(['RELEASE_TO_SELLER', 'REFUND_TO_BUYER'], {
    message: 'Keputusan resolusi wajib diisi',
  }),
  adminNotes: z
    .string()
    .min(20, { message: 'Catatan admin minimal 20 karakter' })
    .max(2000, { message: 'Catatan admin maksimal 2000 karakter' }),
});

export type ResolveDisputeDto = z.infer<typeof ResolveDisputeSchema>;