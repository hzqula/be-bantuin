import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';

const server = express();

const createNestServer = async (expressInstance) => {
    const app = await NestFactory.create(
        AppModule,
        new ExpressAdapter(expressInstance),
    );

    // Enable CORS
    app.enableCors({
        origin: '*',
        credentials: true,
    });

    await app.init();
    return app;
};

// Cache the instance
let isInitialized = false;

export default async function (req, res) {
    if (!isInitialized) {
        await createNestServer(server);
        isInitialized = true;
    }
    server(req, res);
}
