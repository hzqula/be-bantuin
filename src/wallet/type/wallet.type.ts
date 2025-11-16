/**
 * Wallet System Type Definitions
 * 
 * File ini mendefinisikan semua tipe data untuk wallet system.
 * Wallet system menangani balance management, transaction history,
 * dan withdrawal processing untuk sellers.
 */

/**
 * Status untuk withdrawal request
 * 
 * PENDING: Withdrawal baru dibuat, menunggu verifikasi admin
 * PROCESSING: Admin sudah approve, sedang diproses ke bank
 * COMPLETED: Dana sudah masuk ke rekening seller
 * FAILED: Withdrawal gagal (wrong account, insufficient balance, dll)
 * CANCELLED: Withdrawal dibatalkan (oleh seller atau admin)
 */
export type WithdrawalStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Bank codes yang support untuk withdrawal
 * 
 * Ini adalah list bank-bank major di Indonesia.
 * Bisa diperluas sesuai kebutuhan.
 */
export type BankCode =
  | 'BCA'
  | 'MANDIRI'
  | 'BNI'
  | 'BRI'
  | 'CIMB'
  | 'PERMATA'
  | 'DANAMON'
  | 'BNC'
  | 'MEGA'
  | 'PANIN'
  | 'BTN'
  | 'BSI'
  | 'MUAMALAT';

/**
 * Interface untuk wallet record
 * 
 * Setiap user (khususnya seller) punya satu wallet.
 * Balance di sini adalah available balance yang bisa di-withdraw.
 */
export interface WalletRecord {
  id: string;
  userId: string;
  balance: number; // Available balance dalam Rupiah
  pendingBalance: number; // Balance yang sedang dalam escrow
  totalEarnings: number; // Total earnings sepanjang waktu
  totalWithdrawn: number; // Total yang sudah di-withdraw
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface untuk wallet transaction
 * 
 * Setiap perubahan balance tercatat sebagai transaction.
 * Ini penting untuk audit trail dan transparency.
 */
export interface WalletTransactionRecord {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amount: number; // Positive = credit, Negative = debit
  balanceBefore: number;
  balanceAfter: number;
  refOrderId?: string; // Reference ke order jika applicable
  refWithdrawalId?: string; // Reference ke withdrawal jika applicable
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Tipe transaksi wallet yang lebih lengkap
 */
export type WalletTransactionType =
  | 'ESCROW_HOLD' // Dana ditahan (negative)
  | 'ESCROW_RELEASE' // Dana dilepas (positive)
  | 'WITHDRAWAL' // Seller withdraw (negative)
  | 'WITHDRAWAL_REVERSAL' // Withdrawal failed, dana dikembalikan (positive)
  | 'REFUND' // Refund dari cancelled order (amount depends)
  | 'PLATFORM_FEE' // Fee yang diambil platform (negative)
  | 'ADJUSTMENT' // Manual adjustment oleh admin (bisa + atau -)
  | 'BONUS' // Bonus dari platform (positive)
  | 'PENALTY' // Penalty karena violation (negative);

/**
 * Interface untuk withdrawal request
 * 
 * Ketika seller mau withdraw, mereka create request ini.
 * Admin akan review dan process.
 */
export interface WithdrawalRequest {
  id: string;
  userId: string;
  walletId: string;
  amount: number;
  bankCode: BankCode;
  accountNumber: string;
  accountHolderName: string;
  status: WithdrawalStatus;
  notes?: string; // Notes dari seller
  adminNotes?: string; // Notes dari admin (reason for rejection, dll)
  processedBy?: string; // Admin ID yang process
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface untuk wallet summary/overview
 * 
 * Ini adalah data yang ditampilkan di dashboard seller.
 * Menggabungkan data dari wallet, transactions, dan withdrawals.
 */
export interface WalletSummary {
  balance: number;
  pendingBalance: number; // Dana dalam escrow
  availableForWithdrawal: number; // Balance - minimum balance requirement
  totalEarnings: number;
  totalWithdrawn: number;
  thisMonthEarnings: number;
  thisMonthWithdrawn: number;
  pendingWithdrawals: number; // Total withdrawal requests yang pending
  recentTransactions: WalletTransactionRecord[];
  pendingWithdrawalRequests: WithdrawalRequest[];
}

/**
 * Interface untuk withdrawal creation response
 */
export interface CreateWithdrawalResponse {
  success: boolean;
  message: string;
  data: {
    withdrawalId: string;
    amount: number;
    estimatedArrival: string; // Human readable, e.g., "1-2 hari kerja"
    newBalance: number;
  };
}

/**
 * Interface untuk bank account validation result
 * 
 * Sebelum process withdrawal, kita bisa validate bank account
 * untuk mencegah error (wrong account number, typo, dll)
 */
export interface BankAccountValidation {
  isValid: boolean;
  accountName?: string; // Nama pemilik rekening dari bank
  bankName?: string;
  error?: string;
}

/**
 * Constants untuk wallet system
 */
export const WALLET_CONSTANTS = {
  // Minimum balance yang harus tetap ada di wallet
  // Ini untuk prevent user withdraw semua dan balance jadi 0 atau negative
  MIN_BALANCE: 0,
  
  // Minimum amount untuk withdrawal
  // Set cukup tinggi untuk cost-effective (admin fee, dll)
  MIN_WITHDRAWAL: 50_000, // 50 ribu
  
  // Maximum amount untuk single withdrawal
  // Untuk security dan fraud prevention
  MAX_WITHDRAWAL: 10_000_000, // 10 juta
  
  // Withdrawal fee (fixed atau percentage)
  WITHDRAWAL_FEE_FIXED: 5_000, // 5 ribu per withdrawal
  WITHDRAWAL_FEE_PERCENTAGE: 0, // 0% untuk sekarang
  
  // Processing time estimate
  PROCESSING_TIME_DAYS: {
    MIN: 1,
    MAX: 3,
  },
  
  // Maximum pending withdrawals per user
  MAX_PENDING_WITHDRAWALS: 3,
} as const;

/**
 * Helper untuk format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Helper untuk calculate withdrawal fee
 */
export function calculateWithdrawalFee(amount: number): number {
  const percentageFee = Math.round(
    (amount * WALLET_CONSTANTS.WITHDRAWAL_FEE_PERCENTAGE) / 100
  );
  return WALLET_CONSTANTS.WITHDRAWAL_FEE_FIXED + percentageFee;
}

/**
 * Helper untuk calculate net amount after fee
 */
export function calculateNetWithdrawalAmount(grossAmount: number): {
  gross: number;
  fee: number;
  net: number;
} {
  const fee = calculateWithdrawalFee(grossAmount);
  const net = grossAmount - fee;
  
  return { gross: grossAmount, fee, net };
}

/**
 * Type guard untuk check valid bank code
 */
export function isValidBankCode(code: string): code is BankCode {
  const validCodes: BankCode[] = [
    'BCA', 'MANDIRI', 'BNI', 'BRI', 'CIMB', 'PERMATA',
    'DANAMON', 'BNC', 'MEGA', 'PANIN', 'BTN', 'BSI', 'MUAMALAT'
  ];
  return validCodes.includes(code as BankCode);
}

/**
 * Get bank name dari bank code
 */
export function getBankName(code: BankCode): string {
  const bankNames: Record<BankCode, string> = {
    BCA: 'Bank Central Asia',
    MANDIRI: 'Bank Mandiri',
    BNI: 'Bank Negara Indonesia',
    BRI: 'Bank Rakyat Indonesia',
    CIMB: 'Bank CIMB Niaga',
    PERMATA: 'Bank Permata',
    DANAMON: 'Bank Danamon',
    BNC: 'Bank Neo Commerce',
    MEGA: 'Bank Mega',
    PANIN: 'Bank Panin',
    BTN: 'Bank Tabungan Negara',
    BSI: 'Bank Syariah Indonesia',
    MUAMALAT: 'Bank Muamalat',
  };
  
  return bankNames[code];
}

/**
 * Format account number untuk display
 * Mask middle digits untuk privacy
 * 
 * Example: 1234567890 -> 123***7890
 */
export function formatAccountNumber(accountNumber: string, masked = true): string {
  if (!masked || accountNumber.length < 8) {
    return accountNumber;
  }
  
  const firstPart = accountNumber.slice(0, 3);
  const lastPart = accountNumber.slice(-4);
  const maskedPart = '*'.repeat(accountNumber.length - 7);
  
  return `${firstPart}${maskedPart}${lastPart}`;
}