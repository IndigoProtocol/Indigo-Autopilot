import { IUserStrategy, ICDP, IStrategyAction, IAssetPrices, IAssetStrategy } from '@cdp-bot/shared';
import { CDPManagerService } from './cdp-manager.service';
import { WalletManagerService } from './wallet-manager.service';
import logger from '../utils/logger';
import { maskAddress, getAssetPrice, delay } from '../utils/common';
import { BaseService } from './base-service';
import { serviceRegistry } from './service-registry';

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
      const assetStrategy = strategy.assetStrategies[cdp.assetType];
      if (!assetStrategy || !assetStrategy.enabled) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: 0,
          currentCR: 0,
          reason: `No enabled strategy configured for asset: ${cdp.assetType}`,
        };
      }

      const assetPrice = getAssetPrice(cdp.assetType, prices);
      if (assetPrice === BigInt(0)) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
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

      if (currentCR > assetStrategy.maxCR) {
        return await this.createWithdrawAction(cdp, assetStrategy, assetPrice, currentCR);
      } else if (currentCR < assetStrategy.minCR) {
        return await this.createDepositAction(cdp, assetStrategy, assetPrice, currentCR, strategy.walletAddress);
      } else {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: `CR ${currentCR}% is within acceptable range (${assetStrategy.minCR}% - ${assetStrategy.maxCR}%)`,
        };
      }

    } catch (error) {
      logger.error('❌ Failed to evaluate CDP strategy:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: 0,
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
    assetStrategy: IAssetStrategy,
    assetPrice: bigint,
    currentCR: number
  ): Promise<IStrategyAction> {
    try {
      const maxWithdrawalPercentage = 80;
      const emergencyStopCR = 115;
      const maxTransactionValue = BigInt(10000_000_000); // 10K ADA

      if (currentCR <= emergencyStopCR) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: `Emergency stop triggered: CR ${currentCR}% at/below emergency threshold ${emergencyStopCR}%`,
        };
      }

      const calculation = this.cdpManager.calculateCollateralAdjustment(
        cdp.collateralAmount,
        cdp.mintedAmount,
        assetPrice,
        assetStrategy.targetCR
      );

      const withdrawAmount = calculation.adjustmentAmount < 0 ? -calculation.adjustmentAmount : BigInt(0);
      
      if (withdrawAmount <= 0) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: 'Calculated withdrawal amount is not positive',
        };
      }

      const maxWithdrawPercentageValue = Math.min(maxWithdrawalPercentage, 95); // Cap at 95%
      const maxWithdrawAmount = (cdp.collateralAmount * BigInt(maxWithdrawPercentageValue)) / BigInt(100);
      
      let safeWithdrawAmount: bigint = withdrawAmount;
      if (safeWithdrawAmount > maxWithdrawAmount) {
        safeWithdrawAmount = maxWithdrawAmount;
      }
      if (safeWithdrawAmount > maxTransactionValue) {
        safeWithdrawAmount = maxTransactionValue;
      }

      const minCRCheck = this.getMinimumCR(cdp.assetType);
      const potentialNewCollateral = cdp.collateralAmount - safeWithdrawAmount;
      const potentialNewCR = this.cdpManager.calculateCurrentCR(potentialNewCollateral, cdp.mintedAmount, assetPrice);

      if (potentialNewCR < minCRCheck) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: `Withdrawal would result in CR ${potentialNewCR.toFixed(1)}% below protocol minimum ${minCRCheck}%`,
        };
      }

      return {
        type: 'WITHDRAW_COLLATERAL',
        cdpId: cdp.cdpId,
        adjustmentAmount: safeWithdrawAmount,
        targetCR: assetStrategy.targetCR,
        currentCR,
        reason: `CR ${currentCR}% above max ${assetStrategy.maxCR}%. Withdrawing ${Number(safeWithdrawAmount) / 1_000_000} ADA to reach ${potentialNewCR.toFixed(1)}%`,
      };

    } catch (error) {
      logger.error('❌ Failed to create withdrawal action:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: assetStrategy.targetCR,
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
    assetStrategy: IAssetStrategy,
    assetPrice: bigint,
    currentCR: number,
    strategyWalletAddress?: string
  ): Promise<IStrategyAction> {
    try {
      const maxTransactionValue = BigInt(10000_000_000); // 10K ADA

      const calculation = this.cdpManager.calculateCollateralAdjustment(
        cdp.collateralAmount,
        cdp.mintedAmount,
        assetPrice,
        assetStrategy.targetCR
      );

      const depositAmount = calculation.adjustmentAmount > 0 ? calculation.adjustmentAmount : BigInt(0);
      
      if (depositAmount <= 0) {
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: 'Calculated deposit amount is not positive',
        };
      }

      const maxTransactionAmount = maxTransactionValue;
      const safeDepositAmount: bigint = depositAmount > maxTransactionAmount ? maxTransactionAmount : depositAmount;

      try {
        const balanceCheckAddress = strategyWalletAddress || cdp.walletAddress;
        
        const walletBalance = await this.walletManager.getWalletBalance(balanceCheckAddress);
        
        const reserveForFees = BigInt(2_000_000);
        const availableForDeposit = walletBalance.lovelace > reserveForFees ? walletBalance.lovelace - reserveForFees : BigInt(0);

        if (safeDepositAmount > availableForDeposit) {
          return {
            type: 'NO_ACTION',
            cdpId: cdp.cdpId,
            targetCR: assetStrategy.targetCR,
            currentCR,
            reason: `Insufficient ADA balance: need ${Number(safeDepositAmount) / 1_000_000} ADA, available ${Number(availableForDeposit) / 1_000_000} ADA (${Number(walletBalance.lovelace) / 1_000_000} ADA total, 2 ADA reserved for fees)`,
          };
        }

        const actualDepositAmount = safeDepositAmount > availableForDeposit ? availableForDeposit : safeDepositAmount;
        
        const newCollateral = cdp.collateralAmount + actualDepositAmount;
        const newCR = this.cdpManager.calculateCurrentCR(newCollateral, cdp.mintedAmount, assetPrice);

        return {
          type: 'DEPOSIT_COLLATERAL',
          cdpId: cdp.cdpId,
          adjustmentAmount: actualDepositAmount,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: `CR ${currentCR}% below min ${assetStrategy.minCR}%. Depositing ${Number(actualDepositAmount) / 1_000_000} ADA (available balance: ${Number(availableForDeposit) / 1_000_000} ADA) to reach ${newCR.toFixed(1)}%`,
        };

      } catch (balanceError) {
        logger.error('❌ Failed to check wallet balance for deposit:', { 
          cdpId: cdp.cdpId, 
          cdpWalletAddress: maskAddress(cdp.walletAddress),
          strategyWalletAddress: strategyWalletAddress ? maskAddress(strategyWalletAddress) : 'not provided',
          error: balanceError 
        });
        
        return {
          type: 'NO_ACTION',
          cdpId: cdp.cdpId,
          targetCR: assetStrategy.targetCR,
          currentCR,
          reason: `Failed to check wallet balance: ${balanceError}`,
        };
      }

    } catch (error) {
      logger.error('❌ Failed to create deposit action:', { cdpId: cdp.cdpId, error });
      return {
        type: 'NO_ACTION',
        cdpId: cdp.cdpId,
        targetCR: assetStrategy.targetCR,
        currentCR,
        reason: `Error calculating deposit: ${error}`,
      };
    }
  }

  /**
   * Get minimum collateral ratio for an asset (Indigo Protocol constraints)
   */
  private getMinimumCR(asset: string): number {
    return StrategyEngineService.MINIMUM_COLLATERAL_RATIOS[asset];
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

      if (!strategy.assetStrategies || Object.keys(strategy.assetStrategies).length === 0) {
        errors.push('At least one asset strategy must be configured');
      }

      for (const [asset, assetStrategy] of Object.entries(strategy.assetStrategies)) {
        if (assetStrategy.targetCR >= assetStrategy.maxCR) {
          errors.push(`${asset}: Target CR must be less than maximum CR`);
        }

        if (assetStrategy.minCR >= assetStrategy.targetCR) {
          errors.push(`${asset}: Minimum CR must be less than target CR`);
        }

        if (assetStrategy.minCR < 120) {
          errors.push(`${asset}: Minimum CR should be at least 120% for safety margin`);
        }

        if (assetStrategy.maxCR > 500) {
          errors.push(`${asset}: Maximum CR seems unusually high (>500%)`);
        }

        const protocolMinCR = this.getMinimumCR(asset);
        if (assetStrategy.minCR < protocolMinCR) {
          errors.push(`${asset}: Minimum CR (${assetStrategy.minCR}%) is below protocol minimum (${protocolMinCR}%)`);
        }
      }

      if (errors.length === 0) {
        const recommendations: string[] = [];
        
        for (const [asset, assetStrategy] of Object.entries(strategy.assetStrategies)) {
          if (assetStrategy.minCR < 150) {
            recommendations.push(`${asset}: Consider setting minimum CR to 150%+ for better safety margin`);
          }
        }
        
        if (recommendations.length > 0) {
          logger.info('Strategy recommendations', { 
            walletAddress: maskAddress(strategy.walletAddress),
            recommendations 
          });
        }
      }

    } catch (error) {
      logger.error('❌ Strategy validation failed:', { strategy, error });
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
        logger.error('❌ Failed to execute strategy action:', {
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