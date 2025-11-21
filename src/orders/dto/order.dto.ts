import { z } from 'zod';

/**
 * Schema untuk membuat pesanan baru
 */
export const CreateOrderSchema = z.object({
  serviceId: z.string().uuid({ message: 'ID jasa tidak valid' }),

  requirements: z
    .string()
    .min(20, { message: 'Deskripsi kebutuhan minimal 20 karakter' })
    .max(2000, { message: 'Deskripsi kebutuhan maksimal 2000 karakter' }),

  attachments: z
    .array(z.string().url({ message: 'URL attachment tidak valid' }))
    .max(10, { message: 'Maksimal 10 file attachment' })
    .default([]),

  customDeadline: z.coerce.date().optional(), // Gunakan coerce untuk date juga jika perlu
});

/**
 * Schema untuk mengirimkan hasil pekerjaan
 */
export const DeliverOrderSchema = z.object({
  deliveryNote: z
    .string()
    .min(10, { message: 'Catatan pengiriman minimal 10 karakter' })
    .max(1000, { message: 'Catatan pengiriman maksimal 1000 karakter' }),

  deliveryFiles: z
    .array(z.string().url({ message: 'URL file tidak valid' }))
    .min(1, { message: 'Minimal 1 file hasil kerja diperlukan' })
    .max(10, { message: 'Maksimal 10 file hasil kerja' }),
});

/**
 * Schema untuk meminta revisi
 */
export const RequestRevisionSchema = z.object({
  revisionNote: z
    .string()
    .min(20, { message: 'Deskripsi revisi minimal 20 karakter' })
    .max(1000, { message: 'Deskripsi revisi maksimal 1000 karakter' }),

  attachments: z
    .array(z.string().url({ message: 'URL attachment tidak valid' }))
    .max(5, { message: 'Maksimal 5 file attachment untuk revisi' })
    .default([]),
});

/**
 * Schema untuk filter dan pencarian order
 * UPDATE: Gunakan z.coerce.number() dan naikkan max limit
 */
export const OrderFilterSchema = z.object({
  role: z.enum(['buyer', 'worker']).optional(),

  status: z
    .enum([
      'DRAFT',
      'WAITING_PAYMENT',
      'PAID_ESCROW',
      'IN_PROGRESS',
      'DELIVERED',
      'REVISION',
      'COMPLETED',
      'CANCELLED',
      'DISPUTED',
      'RESOLVED',
    ])
    .optional(),

  search: z.string().optional(),

  // UPDATE DI SINI:
  page: z.coerce.number().int().positive().default(1),
  // Naikkan max ke 100 agar sesuai dengan request dashboard
  limit: z.coerce.number().int().positive().max(100).default(10),

  sortBy: z
    .enum(['newest', 'oldest', 'deadline', 'price_high', 'price_low'])
    .default('newest'),
});

/**
 * Schema untuk membatalkan order
 */
export const CancelOrderSchema = z.object({
  reason: z
    .string()
    .min(20, { message: 'Alasan pembatalan minimal 20 karakter' })
    .max(500, { message: 'Alasan pembatalan maksimal 500 karakter' }),
});

/**
 * Schema untuk response pembayaran
 */
export const PaymentCallbackSchema = z.object({
  orderId: z.string(),
  transactionId: z.string(),
  status: z.enum(['PENDING', 'SETTLEMENT', 'SUCCESS', 'FAILED', 'EXPIRED']),
  amount: z.number().positive(),
  paymentMethod: z.string(),
  paidAt: z.string().optional(),
});

export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;
export type DeliverOrderDto = z.infer<typeof DeliverOrderSchema>;
export type RequestRevisionDto = z.infer<typeof RequestRevisionSchema>;
export type OrderFilterDto = z.infer<typeof OrderFilterSchema>;
export type CancelOrderDto = z.infer<typeof CancelOrderSchema>;
export type PaymentCallbackDto = z.infer<typeof PaymentCallbackSchema>;
