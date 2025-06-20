import fs from 'fs';
import path from 'path';
import { IUserStrategy } from '@cdp-bot/shared';
import logger from './logger';
import { maskAddress, getAssetPrice } from './common.js';
import { CDPManagerService } from '../services/cdp-manager.service';
import { WalletManagerService } from '../services/wallet-manager.service';

/**
 * Reload environment variables from .env file
 */
export function reloadEnvironmentVariables(): void {
  try {
    const envPath = path.join(process.cwd(), '.env');
    
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envLines = envContent.split('\n');
      
      for (const line of envLines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=');
            process.env[key] = value;
          }
        }
      }
    }
  } catch (error) {
    logger.error('Failed to reload environment variables:', error);
  }
}

/**
 * Log comprehensive strategy and CDP status information
 */
export async function logStrategyAndCDPStatus(
  strategies: IUserStrategy[], 
  currentPrices: any,
  services: {
    cdpManager: CDPManagerService;
    walletManager: WalletManagerService;
  }
): Promise<void> {
  try {
    logger.info('📊 STRATEGY & CDP STATUS REPORT', {
      totalStrategies: strategies.length,
      priceUpdate: {
        iUSD: `₳${(Number(currentPrices.iUSD) / 1_000_000).toFixed(6)}`,
        iBTC: `₳${(Number(currentPrices.iBTC) / 1_000_000).toFixed(2)}`,
        iETH: `₳${(Number(currentPrices.iETH) / 1_000_000).toFixed(2)}`,
        iSOL: `₳${(Number(currentPrices.iSOL) / 1_000_000).toFixed(2)}`,
      }
    });

    for (const strategy of strategies) {
      try {
        const userCDPs = await services.cdpManager.getUserCDPs(strategy.walletAddress);
        
        const balanceResult = await services.walletManager.getWalletBalance(strategy.walletAddress);
        const balanceADA = `${balanceResult.ada.toFixed(6)} ADA`;
        
        const cdpStatuses = [];
        let totalCollateralADA = BigInt(0);
        let totalDebtUSD = 0;
        
        for (const cdp of userCDPs) {
          const assetPrice = getAssetPrice(cdp.assetType, currentPrices);
          const currentCR = services.cdpManager.calculateCurrentCR(
            cdp.collateralAmount,
            cdp.mintedAmount,
            assetPrice
          );
          
          const collateralADA = Number(cdp.collateralAmount) / 1_000_000;
          const debtAmount = Number(cdp.mintedAmount) / 1_000_000;
          const debtValueUSD = debtAmount * (Number(assetPrice) / 1_000_000);
          
          totalCollateralADA += cdp.collateralAmount;
          totalDebtUSD += debtValueUSD;
          
          let actionNeeded = 'MONITOR';
          let actionReason = 'CR within range';
          
          if (currentCR > strategy.maxCR) {
            actionNeeded = 'WITHDRAW';
            actionReason = `CR ${currentCR}% > max ${strategy.maxCR}%`;
          } else if (currentCR < strategy.minCR) {
            actionNeeded = 'DEPOSIT';
            actionReason = `CR ${currentCR}% < min ${strategy.minCR}%`;
          }
          
          cdpStatuses.push({
            cdpId: cdp.cdpId,
            asset: cdp.assetType,
            collateralADA: collateralADA.toFixed(6),
            debt: `${debtAmount.toFixed(6)} ${cdp.assetType}`,
            debtValueUSD: debtValueUSD.toFixed(2),
            currentCR: `${currentCR}%`,
            targetCR: `${strategy.targetCR}%`,
            range: `${strategy.minCR}%-${strategy.maxCR}%`,
            action: actionNeeded,
            reason: actionReason
          });
        }

        logger.info(`👤 STRATEGY: ${maskAddress(strategy.walletAddress)}`, {
          status: strategy.enabled ? 'ACTIVE' : 'DISABLED',
          balance: balanceADA,
          strategy: {
            targetCR: `${strategy.targetCR}%`,
            range: `${strategy.minCR}%-${strategy.maxCR}%`
          },
          portfolio: {
            totalCDPs: userCDPs.length,
            totalCollateralADA: (Number(totalCollateralADA) / 1_000_000).toFixed(6),
            totalDebtUSD: totalDebtUSD.toFixed(2)
          },
          cdps: cdpStatuses
        });

      } catch (error) {
        logger.error(`Failed to get CDP status for ${maskAddress(strategy.walletAddress)}:`, error);
      }
    }

  } catch (error) {
    logger.error('Failed to log strategy and CDP status:', error);
  }
} 