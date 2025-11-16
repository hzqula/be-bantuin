import { z } from 'zod';

// Skema untuk ActivateSellerDto menggunakan Zod
export const ActivateSellerSchema = z.object({
  phoneNumber: z
    .string()
    .nonempty({ message: 'Nomor telepon wajib diisi' })
    .regex(/^(\+62|62|0)[0-9]{9,12}$/, {
      message: 'Format nomor telepon tidak valid',
    }),

  bio: z
    .string()
    .nonempty({ message: 'Bio wajib diisi' })
    .min(50, { message: 'Bio minimal 50 karakter' }),
});

// Tipe TypeScript yang terinfer dari skema Zod
export type ActivateSellerDto = z.infer<typeof ActivateSellerSchema>;