import { z } from 'zod';

export const CreatePayoutAccountSchema = z.object({
  bankName: z.string().nonempty({ message: 'Nama bank wajib diisi' }),
  accountName: z.string().nonempty({ message: 'Nama pemilik rekening wajib diisi' }),
  accountNumber: z
    .string()
    .nonempty({ message: 'Nomor rekening wajib diisi' })
    .regex(/^[0-9]+$/, { message: 'Nomor rekening hanya boleh angka' })
    .min(5, { message: 'Nomor rekening minimal 5 digit' }),
});

export type CreatePayoutAccountDto = z.infer<typeof CreatePayoutAccountSchema>;