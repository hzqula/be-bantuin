import { z } from 'zod';

/**
 * Schema untuk membuat pesanan baru
 * 
 * Ketika pembeli ingin memesan jasa, mereka perlu memberikan informasi
 * tentang apa yang mereka butuhkan (requirements), file pendukung jika ada,
 * dan deadline yang diharapkan. Harga akan diambil dari service terkait.
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

  // Deadline adalah opsional - jika tidak diisi, akan dihitung otomatis
  // berdasarkan deliveryTime dari service
  customDeadline: z.date().optional(),
});

/**
 * Schema untuk mengirimkan hasil pekerjaan
 * 
 * Penyedia jasa menggunakan ini ketika sudah selesai mengerjakan
 * dan siap mengirimkan deliverable kepada pembeli
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
 * 
 * Pembeli menggunakan ini jika hasil kerja belum sesuai harapan
 * dan memerlukan perbaikan
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
 * 
 * Digunakan oleh pembeli dan penyedia jasa untuk melihat
 * daftar pesanan mereka dengan berbagai kriteria
 */
export const OrderFilterSchema = z.object({
  // Role menentukan perspektif: sebagai buyer atau worker
  role: z.enum(['buyer', 'worker']).optional(),

  // Filter berdasarkan status order
  status: z
    .enum([
      'draft',
      'waiting_payment',
      'paid_escrow',
      'in_progress',
      'delivered',
      'revision',
      'completed',
      'cancelled',
      'disputed',
      'resolved',
    ])
    .optional(),

  // Filter berdasarkan status pembayaran
  paymentStatus: z.enum(['unpaid', 'paid', 'refunded']).optional(),

  // Pencarian berdasarkan judul service
  search: z.string().optional(),

  // Pagination
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(10),

  // Sorting
  sortBy: z
    .enum(['newest', 'oldest', 'deadline', 'price_high', 'price_low'])
    .default('newest'),
});

/**
 * Schema untuk membatalkan order
 * 
 * Baik pembeli maupun penyedia jasa bisa membatalkan order
 * dalam kondisi tertentu dengan memberikan alasan
 */
export const CancelOrderSchema = z.object({
  reason: z
    .string()
    .min(20, { message: 'Alasan pembatalan minimal 20 karakter' })
    .max(500, { message: 'Alasan pembatalan maksimal 500 karakter' }),
});

/**
 * Schema untuk membuka dispute
 * 
 * Ketika ada masalah serius yang tidak bisa diselesaikan
 * secara langsung, salah satu pihak bisa membuka dispute
 */
export const CreateDisputeSchema = z.object({
  reason: z
    .string()
    .min(50, { message: 'Alasan dispute minimal 50 karakter' })
    .max(2000, { message: 'Alasan dispute maksimal 2000 karakter' }),

  evidence: z
    .array(z.string().url({ message: 'URL bukti tidak valid' }))
    .min(1, { message: 'Minimal 1 bukti diperlukan untuk dispute' })
    .max(10, { message: 'Maksimal 10 file bukti' }),
});

/**
 * Schema untuk response pembayaran dari payment gateway
 * 
 * Ini adalah data yang diterima dari webhook Midtrans/Xendit
 * setelah pembayaran diproses
 */
export const PaymentCallbackSchema = z.object({
  orderId: z.string(),
  transactionId: z.string(),
  status: z.enum(['pending', 'settlement', 'success', 'failed', 'expired']),
  amount: z.number().positive(),
  paymentMethod: z.string(),
  paidAt: z.string().optional(), // ISO date string
});

// Export semua tipe TypeScript yang diinfer dari schema
export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;
export type DeliverOrderDto = z.infer<typeof DeliverOrderSchema>;
export type RequestRevisionDto = z.infer<typeof RequestRevisionSchema>;
export type OrderFilterDto = z.infer<typeof OrderFilterSchema>;
export type CancelOrderDto = z.infer<typeof CancelOrderSchema>;
export type CreateDisputeDto = z.infer<typeof CreateDisputeSchema>;
export type PaymentCallbackDto = z.infer<typeof PaymentCallbackSchema>;