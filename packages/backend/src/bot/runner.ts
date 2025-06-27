import { IUserStrategy, IStrategyAction } from '@cdp-bot/shared';
import { StrategyEngineService, CDPManagerService, WalletManagerService, serviceRegistry } from '../services';
import logger from '../utils/logger';
import { maskAddress, getAssetPrice } from '../utils/common';
import * as cron from 'node-cron';
import { reloadEnvironmentVariables } from '../utils/bot-utils';

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
        logger.error('❌ Unable to fetch current prices, skipping cycle');
        return;
      }

      const activeStrategies = await this.loadActiveStrategies();
      if (activeStrategies.length === 0) {
        logger.error('❌ No active strategies found, skipping cycle');
        return;
      }

      const totalAssets = activeStrategies.reduce((sum, s) => 
        sum + Object.keys(s.assetStrategies).filter(asset => s.assetStrategies[asset].enabled).length, 0
      );
      logger.info(`AUTOPILOT STATUS - Monitoring ${activeStrategies.length} wallet(s) with ${totalAssets} active asset strategies`);
      
      const priceDisplay = [
        `iUSD: ₳${(Number(currentPrices.iUSD) / 1_000_000).toFixed(6)}`,
        `iBTC: ₳${(Number(currentPrices.iBTC) / 1_000_000).toFixed(2)}`,
        `iETH: ₳${(Number(currentPrices.iETH) / 1_000_000).toFixed(2)}`,
        `iSOL: ₳${(Number(currentPrices.iSOL) / 1_000_000).toFixed(2)}`
      ].join(' | ');
      logger.info(`PRICES - ${priceDisplay}`);

      const cycleResults: any[] = [];
      let totalActionsExecuted = 0;

      for (const strategy of activeStrategies) {
        try {
          const result = await this.processUserStrategy(strategy, currentPrices);
          cycleResults.push(result);
          totalActionsExecuted += result.actionsExecuted;
        } catch (error) {
          logger.error(`❌ Strategy processing failed for ${maskAddress(strategy.walletAddress)}`);
          cycleResults.push({
            walletAddress: strategy.walletAddress,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            actionsExecuted: 0
          });
        }
      }

      if (totalActionsExecuted > 0) {
        logger.info(`CYCLE COMPLETE - ${totalActionsExecuted} actions executed across ${activeStrategies.length} strategies | Next check in 2 minutes`);
      } else {
        // Check if any actions were blocked due to constraints
        let totalActionsNeeded = 0;
        let totalBlockedActions = 0;
        
        for (const result of cycleResults) {
          if (result.actionsGenerated) {
            totalActionsNeeded += result.actionsGenerated;
          }
          if (result.actionsBlocked) {
            totalBlockedActions += result.actionsBlocked;
          }
        }
        
        if (totalBlockedActions > 0) {
          logger.info(`CYCLE COMPLETE - ${totalBlockedActions} actions needed but blocked (insufficient balance/constraints) | Next check in 2 minutes`);
        } else {
          logger.info(`CYCLE COMPLETE - All CDPs within target ranges | Next check in 2 minutes`);
        }
      }

    } catch (error) {
      logger.error('❌ Bot cycle failed');
    }
  }

  /**
   * Process a single user strategy
   */
  private async processUserStrategy(strategy: IUserStrategy, currentPrices: any): Promise<any> {
    try {
      const userCDPs = await this.cdpManager.getUserCDPs(strategy.walletAddress);
      const balanceResult = await this.walletManager.getWalletBalance(strategy.walletAddress);

      const enabledAssets = Object.entries(strategy.assetStrategies)
        .filter(([_, assetStrategy]) => assetStrategy.enabled)
        .map(([asset, _]) => asset);

      let totalCollateral = 0;
      let totalDebtUSD = 0;

      for (const cdp of userCDPs) {
        const assetPrice = getAssetPrice(cdp.assetType, currentPrices);
        const collateralADA = Number(cdp.collateralAmount) / 1_000_000;
        const debtAmount = Number(cdp.mintedAmount) / 1_000_000;
        const debtValueUSD = debtAmount * (Number(assetPrice) / 1_000_000);
        
        totalCollateral += collateralADA;
        totalDebtUSD += debtValueUSD;
      }

      logger.info(`PORTFOLIO ${maskAddress(strategy.walletAddress)} - Balance: ${balanceResult.ada.toFixed(2)} ADA | Collateral: ${totalCollateral.toFixed(2)} ADA | Debt: $${totalDebtUSD.toFixed(2)} | Assets: ${enabledAssets.join(', ')}`);

      for (const cdp of userCDPs) {
        this.logCDPStatus(cdp, strategy, currentPrices);
      }

      const actions: IStrategyAction[] = await this.strategyEngine.evaluateStrategy(strategy, currentPrices);
      
      logger.info(`ACTIONS GENERATED - Total: ${actions.length}`);
      for (const action of actions) {
        logger.info(`  ${action.type}: ${action.reason}`);
      }
      
      if (actions.length === 0) {
        return {
          walletAddress: strategy.walletAddress,
          success: true,
          actionsExecuted: 0,
          actionsGenerated: 0,
          actionsBlocked: 0,
          message: 'No actions required'
        };
      }

      const executableActions = actions.filter(action => {
        return action.type !== 'NO_ACTION';
      });
      
      const blockedActions = actions.filter(action => {
        return action.type === 'NO_ACTION' && action.reason && (
          action.reason.includes('Insufficient') || 
          action.reason.includes('balance') ||
          action.reason.includes('emergency stop')
        );
      });
      
      logger.info(`EXECUTABLE ACTIONS - Total: ${executableActions.length} (filtered from ${actions.length})`);
      
      if (executableActions.length === 0) {
        return {
          walletAddress: strategy.walletAddress,
          success: true,
          actionsExecuted: 0,
          actionsGenerated: actions.length,
          actionsBlocked: blockedActions.length,
          message: blockedActions.length > 0 ? 'Actions blocked by constraints' : 'All CDPs within acceptable range'
        };
      }

      const txHashes = await this.executeActions(executableActions, strategy.walletAddress);

      return {
        walletAddress: strategy.walletAddress,
        success: true,
        actionsExecuted: executableActions.length,
        actionsGenerated: actions.length,
        actionsBlocked: blockedActions.length,
        txHashes,
      };

    } catch (error) {
      logger.error(`❌ Strategy processing failed for ${maskAddress(strategy.walletAddress)}`);
      throw error;
    }
  }

  /**
   * Log CDP status and any required actions
   */
  private logCDPStatus(cdp: any, strategy: IUserStrategy, prices: any): void {
    const assetStrategy = strategy.assetStrategies[cdp.assetType];
    if (!assetStrategy || !assetStrategy.enabled) return;

    const assetPrice = getAssetPrice(cdp.assetType, prices);
    const currentCR = this.cdpManager.calculateCurrentCR(
      cdp.collateralAmount,
      cdp.mintedAmount,
      assetPrice
    );

    const collateralADA = (Number(cdp.collateralAmount) / 1_000_000).toFixed(2);
    const debtAmount = (Number(cdp.mintedAmount) / 1_000_000).toFixed(6);
    
    let action = '✅ MONITOR';
    let reason = 'CR within target range';
    
    if (currentCR > assetStrategy.maxCR) {
      action = '📉 WITHDRAW COLLATERAL';
      reason = `CR ${currentCR.toFixed(1)}% > max ${assetStrategy.maxCR}%`;
    } else if (currentCR < assetStrategy.minCR) {
      action = '📈 ADD COLLATERAL';
      reason = `CR ${currentCR.toFixed(1)}% < min ${assetStrategy.minCR}%`;
    }

    const crDisplay = `${currentCR.toFixed(1)}% (Target: ${assetStrategy.targetCR}%, Range: ${assetStrategy.minCR}%-${assetStrategy.maxCR}%)`;
    
    if (action.includes('MONITOR')) {
      logger.info(`${cdp.assetType} CDP - ${collateralADA} ADA → ${debtAmount} ${cdp.assetType} | CR: ${crDisplay} | ${action}`);
    } else {
      logger.info(`CDP ACTION - ${cdp.assetType}: ${reason} | Collateral: ${collateralADA} ADA | Debt: ${debtAmount} ${cdp.assetType} | ${action}`);
    }
  }

  /**
   * Execute strategy actions
   */
  private async executeActions(actions: IStrategyAction[], walletAddress: string): Promise<string[]> {
    try {
      const txHashes = await this.strategyEngine.executeStrategyActions(actions, walletAddress);
      
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const txHash = txHashes[i];
        const actionType = action.type === 'WITHDRAW_COLLATERAL' ? 'WITHDREW' : 'DEPOSITED';
        const amount = action.adjustmentAmount ? (Number(action.adjustmentAmount) / 1_000_000).toFixed(2) : 'N/A';
        
        if (txHash) {
          logger.info(`CDP ACTION EXECUTED - ${actionType} ${amount} ADA for ${action.cdpId || 'Unknown'} | Tx: ${txHash.substring(0, 8)}...`);
        } else {
          logger.error(`CDP ACTION FAILED - ${actionType} for ${action.cdpId || 'Unknown'}: Transaction failed`);
        }
      }

      return txHashes;

    } catch (error) {
      logger.error(`❌ Action execution failed for ${maskAddress(walletAddress)}`);
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
            logger.warn('Strategy missing walletAddress, skipping');
            continue;
          }
          
          const strategy: IUserStrategy = {
            walletAddress,
            enabled: strategyConfig.enabled !== false,
            assetStrategies: strategyConfig.assetStrategies || {},
          };

          if (Object.keys(strategy.assetStrategies).length === 0 && 
              (strategyConfig.minCR || strategyConfig.maxCR || strategyConfig.targetCR)) {
            
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
            logger.warn(`Invalid strategy configuration for ${maskAddress(walletAddress)}, skipping`);
            continue;
          }

          strategies.push(strategy);

        } catch (error) {
          logger.error('Failed to parse strategy configuration');
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