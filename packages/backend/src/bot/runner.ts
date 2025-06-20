import cron from 'node-cron';
import {StrategyEngineService} from '../services/strategy-engine.service';
import {CDPManagerService} from '../services/cdp-manager.service';
import {WalletManagerService} from '../services/wallet-manager.service';

import {IStrategyAction, IUserStrategy} from '@cdp-bot/shared';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common.js';
import { reloadEnvironmentVariables, logStrategyAndCDPStatus } from '../utils/bot-utils.js';
import { getService, initializeAllServices } from '../services/index.js';

export class BotRunner {
  private _strategyEngine?: StrategyEngineService;
  private _cdpManager?: CDPManagerService;
  private _walletManager?: WalletManagerService;
  private isRunning: boolean = false;
  private cronJob?: cron.ScheduledTask;

  constructor() {}

  private get strategyEngine(): StrategyEngineService {
    if (!this._strategyEngine) {
      this._strategyEngine = getService<StrategyEngineService>('StrategyEngineService');
    }
    return this._strategyEngine;
  }

  private get cdpManager(): CDPManagerService {
    if (!this._cdpManager) {
      this._cdpManager = getService<CDPManagerService>('CDPManagerService');
    }
    return this._cdpManager;
  }

  private get walletManager(): WalletManagerService {
    if (!this._walletManager) {
      this._walletManager = getService<WalletManagerService>('WalletManagerService');
    }
    return this._walletManager;
  }

  /**
   * Initialize the bot runner
   */
  async initialize(): Promise<void> {
    try {
      await initializeAllServices();
      logger.info('✅ BotRunner initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize BotRunner:', error);
      throw error;
    }
  }

  /**
   * Start the bot runner with cron schedule
   * Runs every 1 minute by default
   */
  start(cronSchedule: string = '*/1 * * * *'): void {
    if (this.isRunning) {
      logger.warn('Bot runner is already running');
      return;
    }

    this.cronJob = cron.schedule(cronSchedule, async () => {
      await this.executeBotCycle();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.isRunning = true;
  }

  /**
   * Stop the bot runner
   */
  stop(): void {
    if (!this.isRunning || !this.cronJob) {
      logger.warn('Bot runner is not running');
      return;
    }

    this.cronJob.stop();
    this.isRunning = false;
    logger.info('Bot runner stopped');
  }

  /**
   * Execute one complete bot cycle
   */
  private async executeBotCycle(): Promise<void> {
    logger.info('Starting bot execution cycle');

    try {
      const activeStrategies = await this.loadActiveStrategies();
      
      if (activeStrategies.length === 0) {
        logger.info('No active strategies found');
        return;
      }

      const currentPrices = await this.cdpManager.getCurrentPrices();
      if (!currentPrices) {
        logger.error('Unable to fetch current prices, skipping cycle');
        return;
      }

      await logStrategyAndCDPStatus(activeStrategies, currentPrices, {
        cdpManager: this.cdpManager,
        walletManager: this.walletManager
      });

      const cycleResults = [];
      for (const strategy of activeStrategies) {
        try {
          const result = await this.processUserStrategy(strategy, currentPrices);
          cycleResults.push(result);
        } catch (error) {
                logger.error('Failed to process user strategy', {
        walletAddress: maskAddress(strategy.walletAddress),
        error
      });
          cycleResults.push({
            walletAddress: strategy.walletAddress,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            actionsExecuted: 0
          });
        }
      }

      const successfulStrategies = cycleResults.filter(r => r.success).length;
      const totalActionsExecuted = cycleResults.reduce((sum, r) => sum + r.actionsExecuted, 0);

      logger.info('Bot cycle completed', {
        totalStrategies: activeStrategies.length,
        successfulStrategies,
        totalActionsExecuted,
        prices: {
          iUSD: currentPrices.iUSD.toString(),
          iBTC: currentPrices.iBTC.toString(),
          iETH: currentPrices.iETH.toString(),
          iSOL: currentPrices.iSOL.toString(),
        }
      });

    } catch (error) {
      logger.error('Bot cycle failed:', error);
    }
  }

  /**
   * Process a single user strategy
   */
  private async processUserStrategy(strategy: IUserStrategy, currentPrices: any): Promise<any> {
    try {


      const actions: IStrategyAction[] = await this.strategyEngine.evaluateStrategy(strategy, currentPrices);
      
      if (actions.length === 0) {
        return {
          walletAddress: strategy.walletAddress,
          success: true,
          actionsExecuted: 0,
          message: 'No actions required'
        };
      }

      const executableActions = actions.filter(action => {
        return action.type !== 'NO_ACTION';
      });
      
      if (executableActions.length === 0) {
              logger.info('NO executable actions for user CDPs', {
        walletAddress: maskAddress(strategy.walletAddress),
        reasons: actions.map(a => a.reason).filter(Boolean)
      });
        return {
          walletAddress: strategy.walletAddress,
          success: true,
          actionsExecuted: 0,
          message: 'All CDPs within acceptable range'
        };
      }

      const txHashes = await this.executeActions(executableActions, strategy.walletAddress);

      return {
        walletAddress: strategy.walletAddress,
        success: true,
        actionsExecuted: executableActions.length,
        txHashes,
      };

    } catch (error) {
      logger.error('Failed to process user strategy:', {
        walletAddress: maskAddress(strategy.walletAddress),
        error
      });
      throw error;
    }
  }

  /**
   * Execute strategy actions
   */
  private async executeActions(actions: IStrategyAction[], walletAddress: string): Promise<string[]> {
    try {
      logger.info('Executing strategy actions', {
        actionCount: actions.length,
        walletAddress: maskAddress(walletAddress),
        actions: actions.map(a => ({
          type: a.type,
          cdpId: a.cdpId,
          adjustmentAmount: a.adjustmentAmount?.toString()
        }))
      });

      return await this.strategyEngine.executeStrategyActions(actions, walletAddress);

    } catch (error) {
      logger.error('Failed to execute strategy actions:', {
        walletAddress: maskAddress(walletAddress),
        error
      });
      return [];
    }
  }

  /**
   * Load active user strategies from environment variables (with real-time reload)
   */
  private async loadActiveStrategies(): Promise<IUserStrategy[]> {
    reloadEnvironmentVariables();
    
    const strategies: IUserStrategy[] = [];

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('STRATEGY_') && value && !key.includes('EXECUTION_INTERVAL')) {
        try {
          const strategyConfig = JSON.parse(value);
          
          const walletAddress = strategyConfig.walletAddress;
          if (!walletAddress) {
            logger.warn('Strategy missing walletAddress, skipping', { envKey: key });
            continue;
          }
          
          const strategy: IUserStrategy = {
            walletAddress,
            enabled: strategyConfig.enabled !== false,
            minCR: strategyConfig.minCR || 150,
            maxCR: strategyConfig.maxCR || 175,
            targetCR: strategyConfig.targetCR || 160,
          };

          const validation = this.strategyEngine.validateStrategy(strategy);
          if (!validation.isValid) {
            logger.warn('Invalid strategy configuration, skipping', {
              walletAddress: maskAddress(walletAddress),
              errors: validation.errors
            });
            continue;
          }

          strategies.push(strategy);

        } catch (error) {
          logger.error('Failed to parse strategy configuration', {
            envKey: key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return strategies.filter(s => s.enabled);
  }

  /**
   * Get bot status
   */
  getStatus(): { isRunning: boolean; cronSchedule?: string } {
    return {
      isRunning: this.isRunning,
      cronSchedule: this.isRunning ? 'Every 2 minutes' : undefined
    };
  }

  /**
   * Run bot cycle manually (for testing)
   */
  async runOnce(): Promise<void> {
    logger.info('Running bot cycle manually');
    await this.executeBotCycle();
  }



}