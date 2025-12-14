import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { StorageService } from './storage.service';
import {
  UploadFileSchema,
  GetFileSchema,
  UpdateFileSchema,
  DeleteFileSchema,
  UploadAccountPhotoSchema,
  UploadServicePhotoSchema,
  UploadSellerOrderPhotoSchema,
  UploadBuyerOrderPhotoSchema,
} from './dto/upload.dto';
import { ZodValidationPipe } from 'nestjs-zod';

/**
 * Konfigurasi Multer untuk validasi Gambar
 * Membatasi hanya file: jpg, jpeg, png, gif, webp
 * Max size: 5MB
 */
const imageUploadOptions = {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (
    _req: any,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (file.mimetype.match(/^image\/(jpg|jpeg|png|gif|webp)$/)) {
      // File diterima
      cb(null, true);
    } else {
      // File ditolak
      cb(
        new BadRequestException(
          'Format file tidak valid. Hanya diperbolehkan JPG, JPEG, PNG, GIF, atau WEBP.',
        ),
        false,
      );
    }
  },
};

@Controller('upload')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Upload file ke Supabase Storage
   * POST /api/upload
   *
   * Body (form-data):
   * - file: File yang akan diupload
   * - bucket: (optional) Nama bucket, default: 'uploads'
   * - path: (optional) Path custom untuk file
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadFileSchema))
    dto: { bucket: string; path?: string },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.uploadFile(file, {
      bucket: dto.bucket,
      path: dto.path,
    });

    return {
      success: true,
      message: 'File berhasil diupload',
      data: result,
    };
  }

  /**
   * Get file dari Supabase Storage
   * GET /api/upload?bucket=uploads&path=2024/1/file.jpg
   *
   * Query parameters:
   * - bucket: (optional) Nama bucket, default: 'uploads'
   * - path: (required) Path file di storage
   */
  @Get()
  async getFile(
    @Query(new ZodValidationPipe(GetFileSchema))
    query: { bucket: string; path: string },
    @Res() res: Response,
  ) {
    const result = await this.storageService.getFile({
      bucket: query.bucket,
      path: query.path,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.filename}"`,
    );
    res.send(result.data);
  }

  /**
   * Update file di Supabase Storage
   * PUT /api/upload?bucket=uploads&path=2024/1/file.jpg
   *
   * Body (form-data):
   * - file: File baru yang akan menggantikan file lama
   *
   * Query parameters:
   * - bucket: (optional) Nama bucket, default: 'uploads'
   * - path: (required) Path file yang akan diupdate
   */
  @Put()
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async updateFile(
    @UploadedFile() file: Express.Multer.File,
    @Query(new ZodValidationPipe(UpdateFileSchema))
    query: { bucket: string; path: string },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.updateFile(file, {
      bucket: query.bucket,
      path: query.path,
    });

    return {
      success: true,
      message: 'File berhasil diupdate',
      data: result,
    };
  }

  /**
   * Delete file dari Supabase Storage
   * DELETE /api/upload?bucket=uploads&path=2024/1/file.jpg
   *
   * Query parameters:
   * - bucket: (optional) Nama bucket, default: 'uploads'
   * - path: (required) Path file yang akan dihapus
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteFile(
    @Query(new ZodValidationPipe(DeleteFileSchema))
    query: {
      bucket: string;
      path: string;
    },
  ) {
    const result = await this.storageService.deleteFile({
      bucket: query.bucket,
      path: query.path,
    });

    return {
      success: true,
      message: 'File berhasil dihapus',
      data: result,
    };
  }

  /**
   * Upload foto akun
   * POST /api/upload/account-photo
   *
   * Body (form-data):
   * - file: File foto akun
   * - fullName: Nama lengkap user
   * - nim: (optional) NIM user
   * - bucket: (optional) Nama bucket, default: 'uploads'
   *
   * Format path: [nama-nim]/filename
   */
  @Post('account-photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadAccountPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadAccountPhotoSchema))
    dto: { bucket: string; fullName: string; nim?: string | null },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.uploadAccountPhoto(file, {
      bucket: dto.bucket,
      fullName: dto.fullName,
      nim: dto.nim || null,
    });

    return {
      success: true,
      message: 'Foto akun berhasil diupload',
      data: result,
    };
  }

  /**
   * Upload foto jasa (penjual)
   * POST /api/upload/service-photo
   *
   * Body (form-data):
   * - file: File foto jasa
   * - fullName: Nama lengkap penjual
   * - nim: (optional) NIM penjual
   * - serviceName: Nama jasa
   * - bucket: (optional) Nama bucket, default: 'uploads'
   *
   * Format path: [nama-nim]/penjual/[nama-jasa]/filename
   */
  @Post('service-photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadServicePhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadServicePhotoSchema))
    dto: {
      bucket: string;
      fullName: string;
      nim?: string | null;
      serviceName: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.uploadServicePhoto(file, {
      bucket: dto.bucket,
      fullName: dto.fullName,
      nim: dto.nim || null,
      serviceName: dto.serviceName,
    });

    return {
      success: true,
      message: 'Foto jasa berhasil diupload',
      data: result,
    };
  }

  /**
   * Upload foto pesanan penjual
   * POST /api/upload/seller-order-photo
   *
   * Body (form-data):
   * - file: File foto pesanan
   * - fullName: Nama lengkap penjual
   * - nim: (optional) NIM penjual
   * - orderName: Nama pesanan
   * - bucket: (optional) Nama bucket, default: 'uploads'
   *
   * Format path: [nama-nim]/penjual/[nama-pesanan]/filename
   */
  @Post('seller-order-photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadSellerOrderPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadSellerOrderPhotoSchema))
    dto: {
      bucket: string;
      fullName: string;
      nim?: string | null;
      orderName: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.uploadSellerOrderPhoto(file, {
      bucket: dto.bucket,
      fullName: dto.fullName,
      nim: dto.nim || null,
      orderName: dto.orderName,
    });

    return {
      success: true,
      message: 'Foto pesanan penjual berhasil diupload',
      data: result,
    };
  }

  /**
   * Upload foto pesanan pembeli
   * POST /api/upload/buyer-order-photo
   *
   * Body (form-data):
   * - file: File foto pesanan
   * - fullName: Nama lengkap pembeli
   * - nim: (optional) NIM pembeli
   * - orderName: Nama pesanan
   * - bucket: (optional) Nama bucket, default: 'uploads'
   *
   * Format path: [nama-nim]/pembeli/[nama-pesanan]/filename
   */
  @Post('buyer-order-photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadBuyerOrderPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(UploadBuyerOrderPhotoSchema))
    dto: {
      bucket: string;
      fullName: string;
      nim?: string | null;
      orderName: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const result = await this.storageService.uploadBuyerOrderPhoto(file, {
      bucket: dto.bucket,
      fullName: dto.fullName,
      nim: dto.nim || null,
      orderName: dto.orderName,
    });

    return {
      success: true,
      message: 'Foto pesanan pembeli berhasil diupload',
      data: result,
    };
  }
}
