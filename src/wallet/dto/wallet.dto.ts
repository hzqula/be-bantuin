import { z } from 'zod';
import { WALLET_CONSTANTS } from '../type/wallet.type';

/**
 * Schema untuk create withdrawal request
 * 
 * Seller menggunakan ini untuk request withdrawal dana dari wallet
 * ke rekening bank mereka. Validasi ketat diperlukan untuk mencegah
 * error yang bisa menyebabkan dana stuck atau lost.
 */
export const CreateWithdrawalSchema = z.object({
  amount: z
    .number()
    .positive({ message: 'Jumlah withdrawal harus lebih dari 0' })
    .min(WALLET_CONSTANTS.MIN_WITHDRAWAL, {
      message: `Minimal withdrawal adalah Rp ${WALLET_CONSTANTS.MIN_WITHDRAWAL.toLocaleString('id-ID')}`,
    })
    .max(WALLET_CONSTANTS.MAX_WITHDRAWAL, {
      message: `Maksimal withdrawal adalah Rp ${WALLET_CONSTANTS.MAX_WITHDRAWAL.toLocaleString('id-ID')}`,
    })
    .refine(
      (val) => Number.isInteger(val),
      { message: 'Jumlah withdrawal harus bilangan bulat (tidak ada desimal)' }
    ),

  bankCode: z
    .enum([
      'BCA',
      'MANDIRI',
      'BNI',
      'BRI',
      'CIMB',
      'PERMATA',
      'DANAMON',
      'BNC',
      'MEGA',
      'PANIN',
      'BTN',
      'BSI',
      'MUAMALAT',
    ])
    .describe('Kode bank tujuan'),

  accountNumber: z
    .string()
    .min(5, { message: 'Nomor rekening minimal 5 digit' })
    .max(25, { message: 'Nomor rekening maksimal 25 karakter' })
    .regex(/^[0-9]+$/, {
      message: 'Nomor rekening hanya boleh berisi angka',
    })
    .describe('Nomor rekening bank tujuan'),

  accountHolderName: z
    .string()
    .min(3, { message: 'Nama pemilik rekening minimal 3 karakter' })
    .max(100, { message: 'Nama pemilik rekening maksimal 100 karakter' })
    .regex(/^[a-zA-Z\s.]+$/, {
      message: 'Nama pemilik rekening hanya boleh huruf, spasi, dan titik',
    })
    .transform((val) => val.toUpperCase().trim())
    .describe('Nama sesuai rekening bank (akan dikonversi ke uppercase)'),

  notes: z
    .string()
    .max(500, { message: 'Catatan maksimal 500 karakter' })
    .optional()
    .describe('Catatan tambahan (opsional)'),
});

/**
 * Schema untuk admin processing withdrawal
 * 
 * Admin menggunakan ini untuk approve atau reject withdrawal request.
 * Admin bisa memberikan notes untuk explain decision mereka.
 */
export const ProcessWithdrawalSchema = z.object({
  withdrawalId: z
    .string()
    .uuid({ message: 'Withdrawal ID tidak valid' }),

  action: z
    .enum(['approve', 'reject', 'complete', 'fail'])
    .describe(
      'Action yang akan diambil: ' +
      'approve = mulai proses transfer, ' +
      'reject = tolak request, ' +
      'complete = mark sebagai selesai, ' +
      'fail = mark sebagai gagal'
    ),

  adminNotes: z
    .string()
    .min(10, { message: 'Admin notes minimal 10 karakter' })
    .max(500, { message: 'Admin notes maksimal 500 karakter' })
    .optional()
    .describe('Catatan dari admin (wajib untuk reject)'),

  proofOfTransfer: z
    .string()
    .url({ message: 'Proof of transfer harus URL valid' })
    .optional()
    .describe('URL bukti transfer (opsional, untuk complete action)'),
});

/**
 * Schema untuk cancel withdrawal (by user)
 * 
 * Seller bisa cancel withdrawal request mereka selama masih pending.
 * Setelah processing, tidak bisa di-cancel lagi.
 */
export const CancelWithdrawalSchema = z.object({
  withdrawalId: z
    .string()
    .uuid({ message: 'Withdrawal ID tidak valid' }),

  reason: z
    .string()
    .min(10, { message: 'Alasan pembatalan minimal 10 karakter' })
    .max(300, { message: 'Alasan pembatalan maksimal 300 karakter' })
    .optional()
    .describe('Alasan pembatalan (opsional)'),
});

/**
 * Schema untuk query wallet transactions
 * 
 * User bisa filter transaction history berdasarkan type, date range, dll.
 */
export const WalletTransactionFilterSchema = z.object({
  type: z
    .enum([
      'ESCROW_HOLD',
      'ESCROW_RELEASE',
      'WITHDRAWAL',
      'WITHDRAWAL_REVERSAL',
      'REFUND',
      'PLATFORM_FEE',
      'ADJUSTMENT',
      'BONUS',
      'PENALTY',
    ])
    .optional()
    .describe('Filter berdasarkan tipe transaksi'),

  startDate: z
    .string()
    .datetime({ message: 'Start date harus format ISO datetime' })
    .optional()
    .describe('Filter transaksi dari tanggal ini'),

  endDate: z
    .string()
    .datetime({ message: 'End date harus format ISO datetime' })
    .optional()
    .describe('Filter transaksi sampai tanggal ini'),

  orderId: z
    .string()
    .uuid({ message: 'Order ID tidak valid' })
    .optional()
    .describe('Filter transaksi untuk order tertentu'),

  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe('Halaman pagination'),

  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe('Jumlah items per halaman'),

  sortBy: z
    .enum(['newest', 'oldest', 'amount_high', 'amount_low'])
    .default('newest')
    .describe('Urutan sorting'),
});

/**
 * Schema untuk manual adjustment (admin only)
 * 
 * Admin bisa melakukan manual adjustment ke wallet balance
 * untuk handle edge cases, compensations, atau corrections.
 */
export const ManualAdjustmentSchema = z.object({
  userId: z
    .string()
    .uuid({ message: 'User ID tidak valid' }),

  amount: z
    .number()
    .refine(
      (val) => val !== 0,
      { message: 'Amount tidak boleh 0' }
    )
    .refine(
      (val) => Number.isInteger(val),
      { message: 'Amount harus bilangan bulat' }
    )
    .describe('Amount adjustment (positive = tambah, negative = kurang)'),

  reason: z
    .string()
    .min(20, { message: 'Alasan adjustment minimal 20 karakter' })
    .max(500, { message: 'Alasan adjustment maksimal 500 karakter' })
    .describe('Alasan detail untuk adjustment ini'),

  category: z
    .enum(['BONUS', 'PENALTY', 'ADJUSTMENT'])
    .describe('Kategori adjustment'),

  metadata: z
    .record(z.any())
    .optional()
    .describe('Metadata tambahan (opsional)'),
});

/**
 * Schema untuk validate bank account (future feature)
 * 
 * Ini bisa digunakan untuk validate account number sebelum withdrawal
 * dengan call ke bank API atau third-party service.
 */
export const ValidateBankAccountSchema = z.object({
  bankCode: z
    .enum([
      'BCA',
      'MANDIRI',
      'BNI',
      'BRI',
      'CIMB',
      'PERMATA',
      'DANAMON',
      'BNC',
      'MEGA',
      'PANIN',
      'BTN',
      'BSI',
      'MUAMALAT',
    ]),

  accountNumber: z
    .string()
    .min(5)
    .max(25)
    .regex(/^[0-9]+$/),
});

/**
 * Schema untuk withdrawal summary/report (admin)
 * 
 * Admin bisa generate report untuk semua withdrawals
 * dalam periode tertentu.
 */
export const WithdrawalReportSchema = z.object({
  startDate: z
    .string()
    .datetime()
    .describe('Awal periode report'),

  endDate: z
    .string()
    .datetime()
    .describe('Akhir periode report'),

  status: z
    .enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'all'])
    .default('all')
    .describe('Filter berdasarkan status'),

  bankCode: z
    .enum([
      'BCA', 'MANDIRI', 'BNI', 'BRI', 'CIMB', 'PERMATA',
      'DANAMON', 'BNC', 'MEGA', 'PANIN', 'BTN', 'BSI', 'MUAMALAT'
    ])
    .optional()
    .describe('Filter berdasarkan bank'),

  minAmount: z
    .number()
    .positive()
    .optional()
    .describe('Minimal amount withdrawal'),

  maxAmount: z
    .number()
    .positive()
    .optional()
    .describe('Maksimal amount withdrawal'),
});

// Export inferred types
export type CreateWithdrawalDto = z.infer<typeof CreateWithdrawalSchema>;
export type ProcessWithdrawalDto = z.infer<typeof ProcessWithdrawalSchema>;
export type CancelWithdrawalDto = z.infer<typeof CancelWithdrawalSchema>;
export type WalletTransactionFilterDto = z.infer<typeof WalletTransactionFilterSchema>;
export type ManualAdjustmentDto = z.infer<typeof ManualAdjustmentSchema>;
export type ValidateBankAccountDto = z.infer<typeof ValidateBankAccountSchema>;
export type WithdrawalReportDto = z.infer<typeof WithdrawalReportSchema>;