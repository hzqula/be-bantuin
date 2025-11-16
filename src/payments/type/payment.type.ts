/**
 * Payment System Type Definitions
 * 
 * File ini mendefinisikan semua tipe data yang digunakan dalam sistem pembayaran.
 * Dengan mendefinisikan tipe secara eksplisit di awal, kita menghindari
 * ambiguitas dan error TypeScript yang bisa muncul kemudian.
 */

/**
 * Status pembayaran yang mungkin terjadi
 * 
 * PENDING: Pembayaran sedang menunggu (user belum selesai bayar)
 * SETTLEMENT: Pembayaran berhasil dan sudah settled
 * SUCCESS: Alias untuk settlement (beberapa gateway pakai ini)
 * FAILED: Pembayaran gagal
 * EXPIRED: Payment link sudah kadaluarsa
 * CANCELLED: Pembayaran dibatalkan oleh user
 * REFUND: Pembayaran sudah direfund
 */
export type PaymentStatus = 
  | 'pending' 
  | 'settlement' 
  | 'success' 
  | 'failed' 
  | 'expired' 
  | 'cancelled'
  | 'refund';

/**
 * Metode pembayaran yang tersedia
 */
export type PaymentMethod = 
  | 'bank_transfer'
  | 'gopay'
  | 'shopeepay'
  | 'qris'
  | 'credit_card'
  | 'bca_klikpay'
  | 'cimb_clicks'
  | 'danamon_online'
  | 'alfamart'
  | 'indomaret';

/**
 * Tipe transaksi dalam wallet system
 * 
 * TOP_UP: User menambah saldo
 * ESCROW_HOLD: Dana ditahan saat order dibayar (negative amount)
 * ESCROW_RELEASE: Dana dilepas ke seller saat order complete (positive amount)
 * WITHDRAW: Seller withdraw dana ke rekening
 * REFUND: Dana dikembalikan ke buyer saat cancel/dispute
 * PLATFORM_FEE: Fee yang diambil platform dari transaksi
 */
export type WalletTransactionType = 
  | 'TOP_UP'
  | 'ESCROW_HOLD'
  | 'ESCROW_RELEASE'
  | 'WITHDRAW'
  | 'REFUND'
  | 'PLATFORM_FEE';

/**
 * Interface untuk request pembuatan pembayaran ke Midtrans
 * 
 * Ini adalah data yang kita kirim ke Midtrans API untuk
 * membuat transaksi baru
 */
export interface CreatePaymentRequest {
  orderId: string;
  amount: number;
  customerDetails: {
    firstName: string;
    email: string;
    phone?: string;
  };
  itemDetails: {
    id: string;
    name: string;
    price: number;
    quantity: number;
  }[];
}

/**
 * Interface untuk response dari Midtrans setelah create payment
 * 
 * Midtrans mengembalikan token dan redirect_url yang digunakan
 * frontend untuk menampilkan halaman pembayaran
 */
export interface CreatePaymentResponse {
  token: string;
  redirectUrl: string;
  transactionId: string;
}

/**
 * Interface untuk notifikasi webhook dari Midtrans
 * 
 * Ini adalah struktur data yang dikirim Midtrans ke webhook endpoint kita
 * setelah terjadi perubahan status pembayaran
 * 
 * PENTING: Data ini harus divalidasi dengan signature_key untuk keamanan
 */
export interface MidtransNotification {
  transaction_time: string;
  transaction_status: string;
  transaction_id: string;
  status_message: string;
  status_code: string;
  signature_key: string;
  payment_type: string;
  order_id: string;
  merchant_id: string;
  masked_card?: string;
  gross_amount: string;
  fraud_status?: string;
  currency?: string;
  bank?: string;
  va_numbers?: Array<{
    va_number: string;
    bank: string;
  }>;
  payment_amounts?: Array<{
    paid_at: string;
    amount: string;
  }>;
  settlement_time?: string;
  expiry_time?: string;
}

/**
 * Interface untuk data payment yang disimpan di database
 * 
 * Ini adalah struktur yang kita simpan di tabel Payment
 */
export interface PaymentRecord {
  id: string;
  orderId: string;
  transactionId: string;
  provider: 'midtrans' | 'xendit' | 'manual';
  providerRef: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  paidAmount?: number;
  currency: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface untuk response ke client setelah initiating payment
 * 
 * Ini yang kita return ke frontend setelah berhasil create payment
 */
export interface InitiatePaymentResponse {
  success: boolean;
  message: string;
  data: {
    orderId: string;
    paymentToken: string;
    paymentUrl: string;
    amount: number;
    expiryTime: Date;
  };
}

/**
 * Interface untuk escrow record di wallet transaction
 * 
 * Setiap kali ada escrow hold atau release, kita create record ini
 */
export interface EscrowTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amount: number; // Negative untuk hold, positive untuk release
  refOrderId: string;
  status: 'pending' | 'completed' | 'failed';
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Interface untuk webhook validation result
 * 
 * Setelah validate signature, kita return object ini
 */
export interface WebhookValidationResult {
  isValid: boolean;
  transactionStatus: PaymentStatus | null;
  orderId: string | null;
  amount: number | null;
  error?: string;
}

/**
 * Type guard functions untuk runtime type checking
 * 
 * Fungsi-fungsi ini membantu memastikan data yang masuk
 * sesuai dengan tipe yang kita harapkan
 */
export function isValidPaymentStatus(status: string): status is PaymentStatus {
  return ['pending', 'settlement', 'success', 'failed', 'expired', 'cancelled', 'refund']
    .includes(status);
}

export function isValidPaymentMethod(method: string): method is PaymentMethod {
  return [
    'bank_transfer', 'gopay', 'shopeepay', 'qris', 'credit_card',
    'bca_klikpay', 'cimb_clicks', 'danamon_online', 'alfamart', 'indomaret'
  ].includes(method);
}

/**
 * Helper function untuk mapping Midtrans status ke internal status
 * 
 * Midtrans menggunakan status seperti 'capture', 'settlement', dll
 * Kita perlu mapping ke status internal yang lebih simple
 */
export function mapMidtransStatus(
  transactionStatus: string,
  fraudStatus?: string
): PaymentStatus {
  // Jika fraud detected, langsung mark as failed
  if (fraudStatus === 'deny' || fraudStatus === 'challenge') {
    return 'failed';
  }

  // Mapping berdasarkan transaction status
  switch (transactionStatus) {
    case 'capture':
    case 'settlement':
      return 'settlement';
    case 'pending':
      return 'pending';
    case 'deny':
    case 'failure':
      return 'failed';
    case 'cancel':
      return 'cancelled';
    case 'expire':
      return 'expired';
    case 'refund':
    case 'partial_refund':
      return 'refund';
    default:
      return 'pending';
  }
}

/**
 * Constants untuk payment system
 */
export const PAYMENT_CONSTANTS = {
  // Platform fee percentage (misalnya 5% dari setiap transaksi)
  PLATFORM_FEE_PERCENTAGE: 5,
  
  // Maximum amount untuk single transaction (dalam Rupiah)
  MAX_TRANSACTION_AMOUNT: 50_000_000, // 50 juta
  
  // Minimum amount untuk single transaction
  MIN_TRANSACTION_AMOUNT: 10_000, // 10 ribu
  
  // Payment expiry time (dalam menit)
  PAYMENT_EXPIRY_MINUTES: 24 * 60, // 24 jam
  
  // Currency
  CURRENCY: 'IDR',
} as const;