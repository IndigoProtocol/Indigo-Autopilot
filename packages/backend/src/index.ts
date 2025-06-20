import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { initializeTypeORM, closeTypeORM } from './config/typeorm';
import lucidProvider from './config/lucid';
import logger from './utils/logger';
import CONFIG from './config/index';
import dotenv from 'dotenv';
import { BotRunner } from './bot/runner';
import walletRoutes from './routes/wallet.routes';
import { createBotRoutes } from './routes/bot.routes';
import { initializeAllServices } from './services/index.js';

dotenv.config();

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: CONFIG.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const botRunner = new BotRunner();

app.use('/wallet', walletRoutes);
app.use('/bot', createBotRoutes(botRunner));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/status', async (req, res) => {
  try {
    const { AppDataSource } = await import('./config/typeorm.js');
    const dbStatus = AppDataSource.isInitialized;

    res.json({
      database: dbStatus ? 'connected' : 'disconnected',
      network: CONFIG.CARDANO_NETWORK,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({
      error: 'Status check failed',
      timestamp: new Date().toISOString()
    });
  }
});

async function startServer(): Promise<void> {
  try {
    logger.info('Starting CDP Management Bot backend...');
    
    await initializeTypeORM();
    
    await lucidProvider.initialize();
    
    await initializeAllServices();
    
    await botRunner.initialize();

    if (process.env.AUTO_START_BOT === 'true') {
      const cronSchedule = process.env.BOT_CRON_SCHEDULE || '*/1 * * * *';
      botRunner.start(cronSchedule);
      logger.info('Bot started automatically', { cronSchedule });
    } else {
      logger.info('Bot initialized but not started. Use /bot/start endpoint or set AUTO_START_BOT=true');
    }

    const server = app.listen(CONFIG.API_PORT, () => {
      logger.info('CDP Fund Manager Bot server started', { 
        port: CONFIG.API_PORT,
        botRunning: botRunner.getStatus().isRunning,
        endpoints: {
          health: `http://localhost:${CONFIG.API_PORT}/health`,
          botStatus: `http://localhost:${CONFIG.API_PORT}/bot/status`
        }
      });
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      server.close(async () => {
        try {
          await closeTypeORM();
          logger.info('Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully...');
      server.close(async () => {
        try {
          await closeTypeORM();
          logger.info('Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
}); 