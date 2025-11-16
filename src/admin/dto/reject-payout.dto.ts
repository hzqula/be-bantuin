import { z } from 'zod';

export const RejectPayoutSchema = z.object({
  reason: z
    .string()
    .nonempty({ message: 'Alasan penolakan wajib diisi' })
    .min(10, { message: 'Alasan penolakan minimal 10 karakter' }),
});

export type RejectPayoutDto = z.infer<typeof RejectPayoutSchema>;