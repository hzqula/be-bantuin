import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL'),
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Terapkan Validasi Zod secara Global
  app.useGlobalPipes(new ZodValidationPipe());

  const port = configService.get<number>('PORT')!;
  await app.listen(port);
  console.log(`Server is running on: http://localhost:${port}`);
}

bootstrap();