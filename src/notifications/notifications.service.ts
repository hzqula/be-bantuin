import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config'; 
import * as nodemailer from 'nodemailer'; 
import type { PrismaClient, User } from '@prisma/client';

type NotificationData = {
  userId: string;
  content: string;
  link?: string;
  type?: string;
  emailSubject?: string; 
};

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class NotificationsService implements OnModuleInit {
  private transporter: nodemailer.Transporter;
  private frontendUrl: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService, 
  ) {}

  async onModuleInit() {
    // Baca konfigurasi dari ENV
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    
    // Konfigurasi NodeMailer Transporter
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<boolean>('SMTP_SECURE') === true,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });

    try {
      await this.transporter.verify();
      console.log('✅ SMTP Server Ready: Email notifications are enabled.');
    } catch (error) {
      console.error('❌ SMTP Connection Error: Email notifications are disabled.', error);
    }
  }

  private async sendEmailNotification(user: User, data: NotificationData) {
    if (!user.email || !this.transporter) return;

    const defaultSubject = `[Bantuin] Notifikasi Baru (${data.type || 'UMUM'})`;
    const subject = data.emailSubject || defaultSubject;
    const notifLink = `${this.frontendUrl}${data.link || '/notifications'}`;

    try {
      await this.transporter.sendMail({
        from: `"Bantuin Notifikasi" <${this.transporter.options.auth?.user}>`,
        to: user.email,
        subject: subject,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #2f4550;">Halo ${user.fullName},</h2>
            <p style="font-size: 16px;">Anda memiliki notifikasi baru dari Bantuin:</p>
            <div style="border-left: 3px solid #586f7c; padding-left: 15px; margin: 15px 0;">
                <p style="font-size: 15px; color: #333; margin: 0;">${data.content}</p>
            </div>
            <a href="${notifLink}" style="display: inline-block; padding: 10px 20px; margin-top: 20px; background-color: #2f4550; color: white; text-decoration: none; border-radius: 5px;">
                Lihat di Aplikasi
            </a>
            <p style="margin-top: 30px; font-size: 12px; color: #999;">
                Ini adalah email otomatis.
            </p>
          </div>
        `,
      });
      console.log(`[EMAIL] Notifikasi berhasil dikirim ke ${user.email}`);
    } catch (error) {
      console.error(`[EMAIL ERROR] Gagal mengirim email ke ${user.email}. Pastikan kredensial SMTP benar.`, error);
    }
  }

  async create(data: NotificationData) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
      });
      
      if (!user) {
         console.warn(`User ${data.userId} not found for notification.`);
         return;
      }
      
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });

      void this.sendEmailNotification(user, data);

    } catch (error) {
      console.error('Failed to create notification to DB:', error);
    }
  }

  async createInTx(tx: Tx, data: NotificationData) {
    try {
      await tx.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });

      const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (user) {
        void this.sendEmailNotification(user, data);
      } else {
        console.warn(`User ${data.userId} not found for inTx email.`);
      }

    } catch (error) {
      console.error('Error creating notification in TX:', error);
    }
  }
}