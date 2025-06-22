import { IUserStrategy, IStrategyAction } from '@cdp-bot/shared';
import { StrategyEngineService, CDPManagerService, WalletManagerService, serviceRegistry } from '../services';
import logger from '../utils/logger';
import { maskAddress, formatPricesForLogging } from '../utils/common';
import * as cron from 'node-cron';
import { reloadEnvironmentVariables, logStrategyAndCDPStatus } from '../utils/bot-utils';

export class BotRunner {
  private _strategyEngine?: StrategyEngineService;
  private _cdpManager?: CDPManagerService;
  private _walletManager?: WalletManagerService;
  private isRunning: boolean = false;
  private cronJob?: cron.ScheduledTask;

  constructor() {}

  private get strategyEngine(): StrategyEngineService {
    if (!this._strategyEngine) {
      this._strategyEngine = serviceRegistry.get<StrategyEngineService>('StrategyEngineService');
    }
    return this._strategyEngine;
  }

  private get cdpManager(): CDPManagerService {
    if (!this._cdpManager) {
      this._cdpManager = serviceRegistry.get<CDPManagerService>('CDPManagerService');
    }
    return this._cdpManager;
  }

  private get walletManager(): WalletManagerService {
    if (!this._walletManager) {
      this._walletManager = serviceRegistry.get<WalletManagerService>('WalletManagerService');
    }
    return this._walletManager;
  }

  /**
   * Initialize the bot runner
   */
  async initialize(): Promise<void> {
    try {
      await this.strategyEngine.initialize();
      await this.cdpManager.initialize();
      await this.walletManager.initialize();
    } catch (error) {
      logger.error('❌ Failed to initialize bot runner:', error);
      throw error;
    }
  }

  /**
   * Start the bot with cron schedule
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
   * Stop the bot
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }

    this.isRunning = false;
  }

  /**
   * Execute bot cycle
   */
  private async executeBotCycle(): Promise<void> {
    try {
      const currentPrices = await this.cdpManager.getCurrentPrices();
      if (!currentPrices) {
        logger.error('Unable to fetch current prices, skipping cycle');
        return;
      }

      const activeStrategies = await this.loadActiveStrategies();
      if (activeStrategies.length === 0) {
        logger.info('No active strategies found, skipping cycle');
        return;
      }

      await logStrategyAndCDPStatus(activeStrategies, currentPrices, {
        cdpManager: this.cdpManager,
        walletManager: this.walletManager
      });

      const cycleResults: any[] = [];

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
        prices: formatPricesForLogging(currentPrices)
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
            assetStrategies: strategyConfig.assetStrategies || {},
          };

          if (Object.keys(strategy.assetStrategies).length === 0 && 
              (strategyConfig.minCR || strategyConfig.maxCR || strategyConfig.targetCR)) {
            logger.warn('Converting legacy strategy format to per-asset format', {
              walletAddress: maskAddress(walletAddress)
            });
            
            const assets = strategyConfig.enabledAssets;
            for (const asset of assets) {
              strategy.assetStrategies[asset] = {
                enabled: true,
                minCR: strategyConfig.minCR,
                maxCR: strategyConfig.maxCR,
                targetCR: strategyConfig.targetCR,
              };
            }
          }

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