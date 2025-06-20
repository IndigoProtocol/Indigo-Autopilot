import { IUserStrategy, ICDP, IStrategyAction, IAssetPrices } from '@cdp-bot/shared';
import { CDPManagerService } from './cdp-manager.service';
import { WalletManagerService } from './wallet-manager.service';
import logger from '../utils/logger';
import { maskAddress, getAssetPrice, delay } from '../utils/common.js';
import { BaseService } from './base-service.js';
import { serviceRegistry } from './service-registry.js';

export class StrategyEngineService extends BaseService {
  private _cdpManager?: CDPManagerService;
  private _walletManager?: WalletManagerService;

  private static readonly MINIMUM_COLLATERAL_RATIOS: Record<string, number> = {
    'iUSD': 130,
    'iETH': 115,
    'iSOL': 115,
    'iBTC': 115
  };

  constructor() {
    super('StrategyEngineService');
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
   * Initialize the service
   */
  async initialize(): Promise<void> {
    return this.executeAsyncInitialize(async () => {
      this.logInitialization(true);
    });
  }

  /**
   * Main decision engine - evaluates strategy for user CDPs with price staleness validation
   */
  async evaluateStrategy(userStrategy: IUserStrategy, currentPrices?: IAssetPrices): Promise<IStrategyAction[]> {
    return this.executeAsync('evaluateStrategy', async () => {
      if (!userStrategy.enabled) {
        logger.info('Strategy is disabled for user', { 
          walletAddress: maskAddress(userStrategy.walletAddress) 
        });
        return [];
      }

      const prices = currentPrices || await this.cdpManager.getCurrentPrices();
      if (!prices) {
        throw new Error('Unable to fetch current asset prices');
      }

      const userCDPs = await this.cdpManager.getUserCDPs(userStrategy.walletAddress);
      if (userCDPs.length === 0) {
        logger.info('No CDPs found for user', { 
          walletAddress: maskAddress(userStrategy.walletAddress) 
        });
        return [];
      }

      const actions: IStrategyAction[] = [];

      for (const cdp of userCDPs) {
        const action = await this.evaluateCDPStrategy(cdp, userStrategy, prices);
        actions.push(action);
      }

      return actions;
    }, { walletAddress: userStrategy.walletAddress });
  }

  /**
   * Evaluate strategy for a single CDP
   */
  private async evaluateCDPStrategy(
    cdp: ICDP, 
    strategy: IUserStrategy, 
    prices: IAssetPrices
  ): Promise<IStrategyAction> {
    try {
      const assetPrice = getAssetPrice(cdp.assetType, prices);
      if (assetPrice === BigInt(0)) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR: 0,
          reason: `No price data available for asset: ${cdp.assetType}`,
        };
      }

      const currentCR = this.cdpManager.calculateCurrentCR(
        cdp.collateralAmount,
        cdp.mintedAmount,
        assetPrice
      );

      cdp.currentCR = currentCR;

      if (currentCR > strategy.maxCR) {
        return await this.createWithdrawAction(cdp, strategy, assetPrice, currentCR);
      } else if (currentCR < strategy.minCR) {
        return await this.createDepositAction(cdp, strategy, assetPrice, currentCR);
      } else {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `CR ${currentCR}% is within acceptable range (${strategy.minCR}% - ${strategy.maxCR}%)`,
        };
      }

    } catch (error) {
      logger.error('Failed to evaluate CDP strategy:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: strategy.targetCR,
        currentCR: 0,
        reason: `Error evaluating CDP: ${error}`,
      };
    }
  }

  /**
   * Create withdrawal action when CR is too high
   */
  private async createWithdrawAction(
    cdp: ICDP,
    strategy: IUserStrategy,
    assetPrice: bigint,
    currentCR: number
  ): Promise<IStrategyAction> {
    try {
      const maxWithdrawalPercentage = 80;
      const minAbsoluteCR = 120;
      const emergencyStopCR = 115;
      const maxTransactionValue = BigInt(10000_000_000); // 10K ADA

      if (currentCR <= emergencyStopCR) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `Emergency stop triggered: CR ${currentCR}% at/below emergency threshold ${emergencyStopCR}%`,
        };
      }

      const calculation = this.cdpManager.calculateCollateralAdjustment(
        cdp.collateralAmount,
        cdp.mintedAmount,
        assetPrice,
        strategy.targetCR
      );

      const withdrawAmount = calculation.adjustmentAmount < 0 ? -calculation.adjustmentAmount : BigInt(0);
      
      if (withdrawAmount <= 0) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: 'Calculated withdrawal amount is not positive',
        };
      }

      const maxWithdrawPercentageValue = Math.min(maxWithdrawalPercentage, 95); // Cap at 95%
      const maxWithdrawAmount = (cdp.collateralAmount * BigInt(maxWithdrawPercentageValue)) / BigInt(100);
      const maxTransactionAmount = maxTransactionValue;
      
      let safeWithdrawAmount: bigint = withdrawAmount;
      if (safeWithdrawAmount > maxWithdrawAmount) {
        safeWithdrawAmount = maxWithdrawAmount;
      }
      if (safeWithdrawAmount > maxTransactionAmount) {
        safeWithdrawAmount = maxTransactionAmount;
      }

      // // Check Indigo Protocol minimum transaction amount (10 ADA)
      // if (safeWithdrawAmount < StrategyEngineService.MINIMUM_TRANSACTION_ADA) {
      //   return {
      //     type: 'NO_ACTION',
      //     cdpId: cdp.cdpId,
      //     targetCR: strategy.targetCR,
      //     currentCR,
      //     reason: `Withdrawal amount ${Number(safeWithdrawAmount) / 1_000_000} ADA is below Indigo Protocol minimum of 10 ADA`,
      //   };
      // }

      // Ensure withdrawal doesn't drop below minimum absolute CR
      const remainingCollateral = cdp.collateralAmount - safeWithdrawAmount;
      const newCR = this.cdpManager.calculateCurrentCR(remainingCollateral, cdp.mintedAmount, assetPrice);
      
      if (newCR < minAbsoluteCR) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `Withdrawal would drop CR below minimum absolute CR (${newCR}% < ${minAbsoluteCR}%)`,
        };
      }

      // Check Indigo Protocol minimum collateral ratio for this asset
      const assetMinimumCR = this.getMinimumCR(cdp.assetType);
      if (newCR < assetMinimumCR) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `Withdrawal would drop CR below Indigo Protocol minimum for ${cdp.assetType} (${newCR}% < ${assetMinimumCR}%)`,
        };
      }

      return {
        type: 'WITHDRAW_COLLATERAL',
        cdpId: cdp.cdpId,
        adjustmentAmount: safeWithdrawAmount,
        targetCR: strategy.targetCR,
        currentCR,
        reason: `CR ${currentCR}% exceeds max ${strategy.maxCR}%. Withdrawing ${Number(safeWithdrawAmount) / 1_000_000} ADA (limited by ${maxWithdrawPercentageValue}% max, ${Number(maxTransactionAmount) / 1_000_000} ADA max tx)`,
      };

    } catch (error) {
      logger.error('Failed to create withdraw action:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: strategy.targetCR,
        currentCR,
        reason: `Error calculating withdrawal: ${error}`,
      };
    }
  }

  /**
   * Create deposit action when CR is too low
   */
  private async createDepositAction(
    cdp: ICDP,
    strategy: IUserStrategy,
    assetPrice: bigint,
    currentCR: number
  ): Promise<IStrategyAction> {
    try {
      const emergencyStopCR = 115;
      const maxTransactionValue = BigInt(10000_000_000); // 10K ADA

      if (currentCR <= emergencyStopCR) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `Emergency stop triggered: CR ${currentCR}% at/below emergency threshold ${emergencyStopCR}%`,
        };
      }

      const calculation = this.cdpManager.calculateCollateralAdjustment(
        cdp.collateralAmount,
        cdp.mintedAmount,
        assetPrice,
        strategy.targetCR
      );

      const depositAmount = calculation.adjustmentAmount > 0 ? calculation.adjustmentAmount : BigInt(0);
      
      if (depositAmount <= 0) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: 'Calculated deposit amount is not positive',
        };
      }

      const maxTransactionAmount = maxTransactionValue;
      const safeDepositAmount: bigint = depositAmount > maxTransactionAmount ? maxTransactionAmount : depositAmount;

      try {
        const walletBalance = await this.walletManager.getWalletBalance(strategy.walletAddress);
        
        const reserveForFees = BigInt(2_000_000);
        const availableForDeposit = walletBalance.lovelace > reserveForFees ? walletBalance.lovelace - reserveForFees : BigInt(0);

        if (safeDepositAmount > availableForDeposit) {
          return {
            type: 'NO_ACTION',
            cdpId: cdp.cdpId,
            targetCR: strategy.targetCR,
            currentCR,
            reason: `Insufficient ADA balance: need ${Number(safeDepositAmount) / 1_000_000} ADA, available ${Number(availableForDeposit) / 1_000_000} ADA (${Number(walletBalance) / 1_000_000} ADA total, 2 ADA reserved for fees)`,
          };
        }

        const actualDepositAmount = safeDepositAmount > availableForDeposit ? availableForDeposit : safeDepositAmount;
        
        const newCollateral = cdp.collateralAmount + actualDepositAmount;
        const newCR = this.cdpManager.calculateCurrentCR(newCollateral, cdp.mintedAmount, assetPrice);

        return {
          type: 'DEPOSIT_COLLATERAL',
          cdpId: cdp.cdpId,
          adjustmentAmount: actualDepositAmount,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `CR ${currentCR}% below min ${strategy.minCR}%. Depositing ${Number(actualDepositAmount) / 1_000_000} ADA (available balance: ${Number(availableForDeposit) / 1_000_000} ADA) to reach ${newCR.toFixed(1)}%`,
        };

      } catch (balanceError) {
        logger.error('Failed to check wallet balance for deposit:', { 
          cdpId: cdp.cdpId, 
          walletAddress: maskAddress(cdp.walletAddress),
          error: balanceError 
        });
        
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: strategy.targetCR,
          currentCR,
          reason: `Failed to check wallet balance: ${balanceError}`,
        };
      }

    } catch (error) {
      logger.error('Failed to create deposit action:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: strategy.targetCR,
        currentCR,
        reason: `Error calculating deposit: ${error}`,
      };
    }
  }

  /**
   * Get minimum collateral ratio for an asset (Indigo Protocol constraints)
   */
  private getMinimumCR(asset: string): number {
    return StrategyEngineService.MINIMUM_COLLATERAL_RATIOS[asset] || 130;
  }

  /**
   * Validate strategy parameters with enhanced safety checks  
   */
  validateStrategy(strategy: IUserStrategy): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      if (!strategy.walletAddress || strategy.walletAddress.trim() === '') {
        errors.push('Wallet address is required');
      }

      if (strategy.targetCR >= strategy.maxCR) {
        errors.push('Target CR must be less than maximum CR');
      }

      if (strategy.minCR >= strategy.targetCR) {
        errors.push('Minimum CR must be less than target CR');
      }

      if (strategy.minCR < 120) {
        errors.push('Minimum CR should be at least 120% for safety margin');
      }

      if (strategy.maxCR > 500) {
        errors.push('Maximum CR seems unusually high (>500%)');
      }

      if (errors.length === 0) {
        const recommendations: string[] = [];
        
        if (strategy.minCR < 150) {
          recommendations.push('Consider setting minimum CR to 150%+ for better safety margin');
        }
        
        if (recommendations.length > 0) {
          logger.info('Strategy recommendations', { 
            walletAddress: maskAddress(strategy.walletAddress),
            recommendations 
          });
        }
      }

    } catch (error) {
      logger.error('Strategy validation failed:', { strategy, error });
      errors.push(`Validation error: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async executeStrategyActions(actions: IStrategyAction[], walletAddress: string): Promise<string[]> {
    const txHashes: string[] = [];

    for (const action of actions) {
      try {
        let txHash: string;

        switch (action.type) {
          case 'WITHDRAW_COLLATERAL':
            if (!action.adjustmentAmount || action.adjustmentAmount <= 0) {
              throw new Error('Invalid withdrawal amount');
            }
            txHash = await this.cdpManager.withdrawCollateral(
              action.cdpId,
              action.adjustmentAmount,
              walletAddress
            );
            break;

          case 'DEPOSIT_COLLATERAL':
            if (!action.adjustmentAmount || action.adjustmentAmount <= 0) {
              throw new Error('Invalid deposit amount');
            }
            txHash = await this.cdpManager.depositCollateral(
              action.cdpId,
              action.adjustmentAmount,
              walletAddress
            );
            break;

          default:
            logger.warn('Unknown action type, skipping', { 
              type: action.type, 
              cdpId: action.cdpId 
            });
            continue;
        }

        txHashes.push(txHash);

        logger.info('Strategy action executed successfully', {
          type: action.type,
          cdpId: action.cdpId,
          currentCR: action.currentCR,
          targetCR: action.targetCR,
          adjustmentAmount: action.adjustmentAmount?.toString(),
          txHash,
          walletAddress: maskAddress(walletAddress)
        });

        await delay(1000);

      } catch (error) {
        logger.error('Failed to execute strategy action:', {
          type: action.type,
          cdpId: action.cdpId,
          walletAddress: maskAddress(walletAddress),
          error
        });
        continue;
      }
    }

    return txHashes;
  }

} 