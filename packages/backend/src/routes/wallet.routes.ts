import { Router, Request, Response } from 'express';
import { WalletManagerService } from '../services/wallet-manager.service';

import { CDPManagerService } from '../services/cdp-manager.service';
import { StrategyEngineService } from '../services/strategy-engine.service';
import { BalanceService } from '../services/balance.service';
import { IUserStrategy } from '@cdp-bot/shared';
import logger from '../utils/logger';
import { maskAddress, getAssetPrice, createErrorResponse, createSuccessResponse } from '../utils/common.js';
import { loadStrategyFromEnv, updateStrategyInEnv, removeStrategyFromEnv } from '../utils/strategy-env.js';
import { getService } from '../services/index.js';

const router = Router();

/**
 * POST /wallet/add - Add a new wallet with seed phrase and strategy
 */
router.post('/add', async (req: Request, res: Response) => {
  try {
    const { seedPhrase, strategy } = req.body;

    if (!seedPhrase || typeof seedPhrase !== 'string') {
      const response = createErrorResponse(new Error('Seed phrase is required and must be a string'), 'Invalid seed phrase');
      return res.status(400).json(response);
    }

    const words = seedPhrase.trim().split(/\s+/);
    if (words.length < 12 || words.length > 24) {
      const response = createErrorResponse(new Error('Seed phrase must be 12-24 words'), 'Invalid seed phrase length');
      return res.status(400).json(response);
    }

    const lucidProvider = (await import('../config/lucid')).default;
    if (!lucidProvider.isInitialized()) {
      await lucidProvider.initialize();
    }
    
    const lucid = lucidProvider.lucid;
    if (!lucid) {
      throw new Error('Lucid not initialized');
    }

    lucid.selectWallet.fromSeed(seedPhrase);
    const walletAddress = await lucid.wallet().address();

    const walletManager = getService<WalletManagerService>('WalletManagerService');
    await walletManager.storeSeedphrase(walletAddress, seedPhrase);

    const strategyConfig: IUserStrategy = {
      walletAddress,
      enabled: strategy?.enabled ?? true,
      targetCR: strategy?.targetCR ?? 160,
      minCR: strategy?.minCR ?? 140,
      maxCR: strategy?.maxCR ?? 180,
    };

    await updateStrategyInEnv(walletAddress, strategyConfig);

    logger.info('✅ Wallet and strategy configured successfully', {
      walletAddress: maskAddress(walletAddress),
      strategy: {
        enabled: strategyConfig.enabled,
        targetCR: strategyConfig.targetCR,
      }
    });

    const response = createSuccessResponse({
      walletAddress: maskAddress(walletAddress),
      strategy: {
        enabled: strategyConfig.enabled,
        targetCR: strategyConfig.targetCR,
        minCR: strategyConfig.minCR,
        maxCR: strategyConfig.maxCR,
      }
    }, 'Wallet configured successfully');
    
    res.json(response);

  } catch (error) {
    logger.error('Failed to add wallet:', error);
    const response = createErrorResponse(error, 'Failed to add wallet');
    res.status(500).json(response);
  }
});

/**
 * PUT /wallet/:address/strategy - Update strategy for a wallet
 */
router.put('/:address/strategy', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { strategy } = req.body;

    if (!strategy) {
      const response = createErrorResponse(new Error('Strategy configuration is required'), 'Missing strategy configuration');
      return res.status(400).json(response);
    }

    const walletManager = getService<WalletManagerService>('WalletManagerService');
    const isManaged = await walletManager.isWalletManaged(address);
    if (!isManaged) {
      const response = createErrorResponse(new Error('Wallet not found'), 'Wallet not found');
      return res.status(404).json(response);
    }

    const updatedStrategy: IUserStrategy = {
      walletAddress: address,
      enabled: strategy.enabled ?? true,
      targetCR: strategy.targetCR ?? 160,
      minCR: strategy.minCR ?? 140,
      maxCR: strategy.maxCR ?? 180,
    };

    await updateStrategyInEnv(address, updatedStrategy);

    logger.info('✅ Strategy updated successfully', {
      walletAddress: maskAddress(address),
      strategy: {
        enabled: updatedStrategy.enabled,
        targetCR: updatedStrategy.targetCR,
      }
    });

    const response = createSuccessResponse({
      strategy: {
        enabled: updatedStrategy.enabled,
        targetCR: updatedStrategy.targetCR,
        minCR: updatedStrategy.minCR,
        maxCR: updatedStrategy.maxCR,
      }
    }, 'Strategy updated successfully');
    
    res.json(response);

  } catch (error) {
    logger.error('Failed to update strategy:', error);
    const response = createErrorResponse(error, 'Failed to update strategy');
    res.status(500).json(response);
  }
});

/**
 * GET /wallet/:address/balance - Get wallet balance
 */
router.get('/:address/balance', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    const walletManager = getService<WalletManagerService>('WalletManagerService');
    const isManaged = await walletManager.isWalletManaged(address);
    if (!isManaged) {
      const response = createErrorResponse(new Error('Wallet not found in managed wallets'), 'Wallet not found in managed wallets');
      return res.status(404).json(response);
    }

    const balanceResult = await walletManager.getWalletBalance(address);

    const balanceService = getService<BalanceService>('BalanceService');
    let assets = {};
    if (balanceService) {
      try {
        assets = await balanceService.getWalletAssets(address);
      } catch (error) {
        logger.warn('Failed to get wallet assets:', error);
      }
    }

    const response = createSuccessResponse({
      address: maskAddress(address),
      balance: {
        ada: balanceResult.ada.toFixed(6),
        lovelace: balanceResult.lovelace.toString(),
        assets
      }
    }, 'Balance retrieved successfully');
    
    res.json(response);

  } catch (error) {
    logger.error('Failed to get wallet balance:', error);
    const response = createErrorResponse(error, 'Failed to get wallet balance');
    res.status(500).json(response);
  }
});

/**
 * GET /wallet/:address/cdps - Get user's CDPs
 */
router.get('/:address/cdps', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    const walletManager = getService<WalletManagerService>('WalletManagerService');
    const isManaged = await walletManager.isWalletManaged(address);
    if (!isManaged) {
      const response = createErrorResponse(new Error('Wallet not found in managed wallets'), 'Wallet not found in managed wallets');
      return res.status(404).json(response);
    }

    const cdpManager = getService<CDPManagerService>('CDPManagerService');

    const cdps = await cdpManager.getUserCDPs(address);
    
    if (cdps.length === 0) {
      const response = createSuccessResponse({
        cdps: [],
        totalCDPs: 0,
        address: maskAddress(address)
      }, 'No CDPs found for this wallet');
      return res.json(response);
    }

    const currentPrices = await cdpManager.getCurrentPrices();
    if (currentPrices) {
      cdps.forEach(cdp => {
        try {
          const assetPrice = getAssetPrice(cdp.assetType, currentPrices);
          if (assetPrice > 0) {
            cdp.currentCR = cdpManager!.calculateCurrentCR(
              cdp.collateralAmount,
              cdp.mintedAmount,
              assetPrice
            );
          }
        } catch (error) {
          logger.warn('Failed to calculate CR for CDP', { 
            cdpId: cdp.cdpId, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      });
    }

    const serializedCDPs = cdps.map(cdp => ({
      ...cdp,
      collateralAmount: cdp.collateralAmount.toString(),
      mintedAmount: cdp.mintedAmount.toString(),
      collateralAmountADA: (Number(cdp.collateralAmount) / 1_000_000).toFixed(6),
      mintedAmountFormatted: (Number(cdp.mintedAmount) / 1_000_000).toFixed(6),
    }));

    const response = createSuccessResponse({
      cdps: serializedCDPs,
      totalCDPs: cdps.length,
      address: maskAddress(address)
    }, 'CDPs retrieved successfully');
    
    res.json(response);

  } catch (error) {
    logger.error('Failed to get user CDPs:', error);
    const response = createErrorResponse(error, 'Failed to get user CDPs');
    res.status(500).json(response);
  }
});

/**
 * GET /wallet/:address/strategy - Get current strategy configuration
 */
router.get('/:address/strategy', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    const walletManager = getService<WalletManagerService>('WalletManagerService');
    const isManaged = await walletManager.isWalletManaged(address);
    if (!isManaged) {
      const response = createErrorResponse(new Error('Wallet not found in managed wallets'), 'Wallet not found in managed wallets');
      return res.status(404).json(response);
    }

    const strategy = loadStrategyFromEnv(address);
    if (!strategy) {
      const response = createSuccessResponse({
        strategy: null,
        address: maskAddress(address)
      }, 'No strategy configured for this wallet');
      return res.json(response);
    }

    const safeStrategy = {
      enabled: strategy.enabled,
      targetCR: strategy.targetCR,
      minCR: strategy.minCR,
      maxCR: strategy.maxCR,
    };

    const response = createSuccessResponse({
      strategy: safeStrategy,
      address: maskAddress(address)
    }, 'Strategy retrieved successfully');
    
    res.json(response);

  } catch (error) {
    logger.error('Failed to get strategy:', error);
    const response = createErrorResponse(error, 'Failed to get strategy');
    res.status(500).json(response);
  }
});

export default router; 