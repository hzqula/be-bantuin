import { z } from 'zod';

/**
 * Schema untuk initiating payment
 * 
 * Digunakan ketika user konfirmasi order dan siap untuk membayar
 * Kita ambil orderId dan optional payment method preference
 */
export const InitiatePaymentSchema = z.object({
  orderId: z
    .string()
    .uuid({ message: 'Order ID tidak valid' }),
  
  paymentMethod: z
    .enum([
      'bank_transfer',
      'gopay',
      'shopeepay',
      'qris',
      'credit_card',
      'bca_klikpay',
      'cimb_clicks',
      'danamon_online',
      'alfamart',
      'indomaret',
    ])
    .optional()
    .describe('Metode pembayaran yang dipilih (opsional)'),
});

/**
 * Schema untuk webhook notification dari Midtrans
 * 
 * PENTING: Schema ini harus match dengan format yang dikirim Midtrans
 * Jika Midtrans update format mereka, schema ini juga harus diupdate
 */
export const MidtransWebhookSchema = z.object({
  transaction_time: z.string(),
  transaction_status: z.string(),
  transaction_id: z.string(),
  status_message: z.string().optional(),
  status_code: z.string(),
  signature_key: z.string(),
  payment_type: z.string(),
  order_id: z.string(),
  merchant_id: z.string().optional(),
  gross_amount: z.string(),
  fraud_status: z.string().optional(),
  currency: z.string().optional(),
  
  // Fields untuk virtual account
  va_numbers: z.array(z.object({
    va_number: z.string(),
    bank: z.string(),
  })).optional(),
  
  // Fields untuk tracking payment
  payment_amounts: z.array(z.object({
    paid_at: z.string(),
    amount: z.string(),
  })).optional(),
  
  settlement_time: z.string().optional(),
  expiry_time: z.string().optional(),
});

/**
 * Schema untuk withdraw request
 * 
 * Seller menggunakan ini untuk withdraw dana dari wallet ke rekening
 */
export const WithdrawRequestSchema = z.object({
  amount: z
    .number()
    .positive({ message: 'Jumlah withdraw harus lebih dari 0' })
    .min(50000, { message: 'Minimal withdraw adalah Rp 50.000' })
    .max(10000000, { message: 'Maksimal withdraw adalah Rp 10.000.000 per transaksi' }),
  
  bankCode: z
    .string()
    .min(2, { message: 'Kode bank tidak valid' })
    .max(10, { message: 'Kode bank tidak valid' })
    .describe('Kode bank tujuan (contoh: BCA, MANDIRI, BNI)'),
  
  accountNumber: z
    .string()
    .min(5, { message: 'Nomor rekening minimal 5 digit' })
    .max(20, { message: 'Nomor rekening maksimal 20 digit' })
    .regex(/^\d+$/, { message: 'Nomor rekening hanya boleh angka' }),
  
  accountHolderName: z
    .string()
    .min(3, { message: 'Nama pemilik rekening minimal 3 karakter' })
    .max(100, { message: 'Nama pemilik rekening maksimal 100 karakter' })
    .describe('Nama sesuai rekening bank'),
  
  notes: z
    .string()
    .max(200, { message: 'Catatan maksimal 200 karakter' })
    .optional()
    .describe('Catatan tambahan untuk withdraw'),
});

/**
 * Schema untuk refund request
 * 
 * Admin atau system menggunakan ini untuk memproses refund
 */
export const RefundRequestSchema = z.object({
  orderId: z
    .string()
    .uuid({ message: 'Order ID tidak valid' }),
  
  amount: z
    .number()
    .positive({ message: 'Jumlah refund harus lebih dari 0' })
    .optional()
    .describe('Jumlah yang akan direfund (opsional, default: full refund)'),
  
  reason: z
    .string()
    .min(10, { message: 'Alasan refund minimal 10 karakter' })
    .max(500, { message: 'Alasan refund maksimal 500 karakter' }),
});

/**
 * Schema untuk checking payment status
 * 
 * User bisa mengecek status pembayaran mereka
 */
export const CheckPaymentStatusSchema = z.object({
  orderId: z
    .string()
    .uuid({ message: 'Order ID tidak valid' }),
});

/**
 * Schema untuk wallet top-up (untuk future feature)
 * 
 * Saat ini belum diimplementasi karena kita fokus pada
 * flow: buyer pay -> escrow -> seller receive
 * 
 * Tapi ini bisa berguna nanti jika kita mau implementasi
 * wallet balance yang bisa di-top up terlebih dahulu
 */
export const TopUpWalletSchema = z.object({
  amount: z
    .number()
    .positive({ message: 'Jumlah top up harus lebih dari 0' })
    .min(10000, { message: 'Minimal top up adalah Rp 10.000' })
    .max(5000000, { message: 'Maksimal top up adalah Rp 5.000.000 per transaksi' }),
  
  paymentMethod: z
    .enum([
      'bank_transfer',
      'gopay',
      'shopeepay',
      'qris',
    ])
    .describe('Metode pembayaran untuk top up'),
});

// Export all inferred types
export type InitiatePaymentDto = z.infer<typeof InitiatePaymentSchema>;
export type MidtransWebhookDto = z.infer<typeof MidtransWebhookSchema>;
export type WithdrawRequestDto = z.infer<typeof WithdrawRequestSchema>;
export type RefundRequestDto = z.infer<typeof RefundRequestSchema>;
export type CheckPaymentStatusDto = z.infer<typeof CheckPaymentStatusSchema>;
export type TopUpWalletDto = z.infer<typeof TopUpWalletSchema>;