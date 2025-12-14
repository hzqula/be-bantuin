import { z } from 'zod';

/**
 * Schema untuk upload file
 */
export const UploadFileSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'), // Default bucket name
  path: z
    .string()
    .min(1, { message: 'Path file tidak boleh kosong' })
    .optional(),
});

export type UploadFileDto = z.infer<typeof UploadFileSchema>;

/**
 * Schema untuk query parameters untuk GET file
 */
export const GetFileSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  path: z.string().min(1, { message: 'Path file tidak boleh kosong' }),
});

export type GetFileDto = z.infer<typeof GetFileSchema>;

/**
 * Schema untuk update file
 */
export const UpdateFileSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  path: z.string().min(1, { message: 'Path file tidak boleh kosong' }),
});

export type UpdateFileDto = z.infer<typeof UpdateFileSchema>;

/**
 * Schema untuk delete file
 */
export const DeleteFileSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  path: z.string().min(1, { message: 'Path file tidak boleh kosong' }),
});

export type DeleteFileDto = z.infer<typeof DeleteFileSchema>;

/**
 * Schema untuk upload foto akun
 * Format: [nama-nim]/filename
 */
export const UploadAccountPhotoSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  fullName: z.string().min(1, { message: 'Nama lengkap tidak boleh kosong' }),
  nim: z.string().optional().nullable(),
});

export type UploadAccountPhotoDto = z.infer<typeof UploadAccountPhotoSchema>;

/**
 * Schema untuk upload foto jasa (penjual)
 * Format: [nama-nim]/penjual/[nama-jasa]/filename
 */
export const UploadServicePhotoSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  fullName: z.string().min(1, { message: 'Nama lengkap tidak boleh kosong' }),
  nim: z.string().optional().nullable(),
  serviceName: z.string().min(1, { message: 'Nama jasa tidak boleh kosong' }),
});

export type UploadServicePhotoDto = z.infer<typeof UploadServicePhotoSchema>;

/**
 * Schema untuk upload foto pesanan penjual
 * Format: [nama-nim]/penjual/[nama-pesanan]/filename
 */
export const UploadSellerOrderPhotoSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  fullName: z.string().min(1, { message: 'Nama lengkap tidak boleh kosong' }),
  nim: z.string().optional().nullable(),
  orderName: z.string().min(1, { message: 'Nama pesanan tidak boleh kosong' }),
});

export type UploadSellerOrderPhotoDto = z.infer<
  typeof UploadSellerOrderPhotoSchema
>;

/**
 * Schema untuk upload foto pesanan pembeli
 * Format: [nama-nim]/pembeli/[nama-pesanan]/filename
 */
export const UploadBuyerOrderPhotoSchema = z.object({
  bucket: z
    .string()
    .min(1, { message: 'Nama bucket tidak boleh kosong' })
    .default('uploads'),
  fullName: z.string().min(1, { message: 'Nama lengkap tidak boleh kosong' }),
  nim: z.string().optional().nullable(),
  orderName: z.string().min(1, { message: 'Nama pesanan tidak boleh kosong' }),
});

export type UploadBuyerOrderPhotoDto = z.infer<
  typeof UploadBuyerOrderPhotoSchema
>;
