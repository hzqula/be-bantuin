import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Services Module
 *
 * This module handles all service-related functionality in the marketplace:
 * - Creating and managing service listings
 * - Searching and filtering services
 * - Service detail retrieval
 * - Service ownership and permissions
 *
 * The module is designed to be the core of the marketplace,
 * allowing sellers to offer their services and buyers to discover them.
 */
@Module({
  imports: [PrismaModule], // Import Prisma for database access
  controllers: [ServicesController], // Register the HTTP controller
  providers: [ServicesService], // Register the business logic service
  exports: [ServicesService], // Export service for use in other modules (e.g., Orders)
})
export class ServicesModule {}
