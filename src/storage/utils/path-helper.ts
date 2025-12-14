/**
 * Helper functions untuk generate path struktur file upload
 */

/**
 * Sanitize string untuk digunakan sebagai nama folder/file
 * Menghapus karakter khusus dan mengganti spasi dengan dash
 */
export function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Hapus karakter khusus
    .replace(/\s+/g, '-') // Ganti spasi dengan dash
    .replace(/-+/g, '-') // Ganti multiple dash dengan single dash
    .replace(/^-+|-+$/g, ''); // Hapus dash di awal/akhir
}

/**
 * Generate path untuk foto akun
 * Format: [nama-nim]/filename
 */
export function generateAccountPhotoPath(
  fullName: string,
  nim: string | null,
  filename: string,
): string {
  const userFolder = nim
    ? `${sanitizeFolderName(fullName)}-${sanitizeFolderName(nim)}`
    : sanitizeFolderName(fullName);
  return `${userFolder}/${filename}`;
}

/**
 * Generate path untuk foto jasa (penjual)
 * Format: [nama-nim]/penjual/[nama-jasa]/filename
 */
export function generateServicePhotoPath(
  fullName: string,
  nim: string | null,
  serviceName: string,
  filename: string,
): string {
  const userFolder = nim
    ? `${sanitizeFolderName(fullName)}-${sanitizeFolderName(nim)}`
    : sanitizeFolderName(fullName);
  const serviceFolder = sanitizeFolderName(serviceName);
  return `${userFolder}/penjual/${serviceFolder}/${filename}`;
}

/**
 * Generate path untuk foto pesanan penjual
 * Format: [nama-nim]/penjual/[nama-pesanan]/filename
 */
export function generateSellerOrderPhotoPath(
  fullName: string,
  nim: string | null,
  orderName: string,
  filename: string,
): string {
  const userFolder = nim
    ? `${sanitizeFolderName(fullName)}-${sanitizeFolderName(nim)}`
    : sanitizeFolderName(fullName);
  const orderFolder = sanitizeFolderName(orderName);
  return `${userFolder}/penjual/${orderFolder}/${filename}`;
}

/**
 * Generate path untuk foto pesanan pembeli
 * Format: [nama-nim]/pembeli/[nama-pesanan]/filename
 */
export function generateBuyerOrderPhotoPath(
  fullName: string,
  nim: string | null,
  orderName: string,
  filename: string,
): string {
  const userFolder = nim
    ? `${sanitizeFolderName(fullName)}-${sanitizeFolderName(nim)}`
    : sanitizeFolderName(fullName);
  const orderFolder = sanitizeFolderName(orderName);
  return `${userFolder}/pembeli/${orderFolder}/${filename}`;
}
