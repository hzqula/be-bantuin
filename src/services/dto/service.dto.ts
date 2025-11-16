import { z } from 'zod';

// Schema for creating a new service
export const CreateServiceSchema = z.object({
  title: z
    .string()
    .min(10, { message: 'Judul minimal 10 karakter' })
    .max(100, { message: 'Judul maksimal 100 karakter' }),

  description: z
    .string()
    .min(50, { message: 'Deskripsi minimal 50 karakter' })
    .max(2000, { message: 'Deskripsi maksimal 2000 karakter' }),

  category: z
    .enum([
      'DESIGN',
      'DATA',
      'CODING',
      'WRITING',
      'EVENT',
      'TUTOR',
      'TECHNICAL',
      'OTHER',
    ])
    .describe('Kategori jasa'),

  price: z
    .number()
    .positive({ message: 'Harga harus lebih dari 0' })
    .max(10000000, { message: 'Harga maksimal Rp 10.000.000' }),

  deliveryTime: z
    .number()
    .int()
    .positive({ message: 'Waktu pengerjaan harus lebih dari 0 hari' })
    .max(90, { message: 'Waktu pengerjaan maksimal 90 hari' }),

  revisions: z
    .number()
    .int()
    .min(0, { message: 'Jumlah revisi minimal 0' })
    .max(10, { message: 'Jumlah revisi maksimal 10' })
    .default(1),

  images: z
    .array(z.string().url({ message: 'URL gambar tidak valid' }))
    .min(1, { message: 'Minimal 1 gambar diperlukan' })
    .max(5, { message: 'Maksimal 5 gambar' })
    .optional()
    .default([]),
});

// Schema for updating service
export const UpdateServiceSchema = CreateServiceSchema.partial();

// Schema for filtering/searching services
export const ServiceFilterSchema = z.object({
  q: z.string().optional(), // Search query
  category: z
    .enum([
      'DESIGN',
      'DATA',
      'CODING',
      'WRITING',
      'EVENT',
      'TUTOR',
      'TECHNICAL',
      'OTHER',
    ])
    .optional(),
  priceMin: z.number().positive().optional(),
  priceMax: z.number().positive().optional(),
  ratingMin: z.number().min(0).max(5).optional(),
  sellerId: z.string().uuid().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(12),
  sortBy: z
    .enum(['newest', 'price_low', 'price_high', 'rating', 'popular'])
    .default('newest'),
});

// Type exports
export type CreateServiceDto = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceDto = z.infer<typeof UpdateServiceSchema>;
export type ServiceFilterDto = z.infer<typeof ServiceFilterSchema>;