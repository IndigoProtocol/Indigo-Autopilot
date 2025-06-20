import { Router, Request, Response } from 'express';
import { BotRunner } from '../bot/runner';
import logger from '../utils/logger';
import { createErrorResponse, createSuccessResponse } from '../utils/common.js';

export function createBotRoutes(botRunner: BotRunner): Router {
  const router = Router();

  /**
   * GET /bot/status - Get bot status
   */
  router.get('/status', (req: Request, res: Response) => {
    try {
      const status = botRunner.getStatus();
      const response = createSuccessResponse({
        ...status,
        timestamp: new Date().toISOString()
      }, 'Bot status retrieved successfully');
      res.json(response);
    } catch (error) {
      logger.error('Failed to get bot status:', error);
      const response = createErrorResponse(error, 'Failed to get bot status');
      res.status(500).json({
        ...response,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /bot/run - Run bot cycle manually
   */
  router.post('/run', async (req: Request, res: Response) => {
    try {
      logger.info('Manual bot run requested');
      await botRunner.runOnce();
      const response = createSuccessResponse({
        timestamp: new Date().toISOString()
      }, 'Bot cycle executed successfully');
      res.json(response);
    } catch (error) {
      logger.error('Failed to run bot cycle:', error);
      const response = createErrorResponse(error, 'Failed to run bot cycle');
      res.status(500).json({
        ...response,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /bot/start - Start bot with cron schedule
   */
  router.post('/start', (req: Request, res: Response) => {
    try {
      const cronSchedule = req.body.cronSchedule || '*/1 * * * *';
      botRunner.start(cronSchedule);
      const response = createSuccessResponse({
        cronSchedule,
        timestamp: new Date().toISOString()
      }, 'Bot started successfully');
      res.json(response);
    } catch (error) {
      logger.error('Failed to start bot:', error);
      const response = createErrorResponse(error, 'Failed to start bot');
      res.status(500).json({
        ...response,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /bot/stop - Stop bot
   */
  router.post('/stop', (req: Request, res: Response) => {
    try {
      botRunner.stop();
      const response = createSuccessResponse({
        timestamp: new Date().toISOString()
      }, 'Bot stopped successfully');
      res.json(response);
    } catch (error) {
      logger.error('Failed to stop bot:', error);
      const response = createErrorResponse(error, 'Failed to stop bot');
      res.status(500).json({
        ...response,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
} 