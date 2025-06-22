import * as IndigoSDK from '@indigo-labs/indigo-sdk';
import { OutRef } from '@lucid-evolution/lucid';
import { IsNull, Repository } from 'typeorm';
import { getRepository, initializeTypeORM } from '../config/typeorm';
import { CollateralizedDebtPosition, Price } from '../entities';
import { IAssetPrices, ICDP, IPriceData } from '@cdp-bot/shared';
import lucidProvider from '../config/lucid';
import indigoParamsConfig from '../config/indigo-params';
import { WalletManagerService } from './wallet-manager.service';
import logger from '../utils/logger';
import { delay, maskAddress } from '../utils/common';
import { BaseService } from './base-service';
import { serviceRegistry } from './service-registry';
import { getAddressDetails } from '@lucid-evolution/utils';

export class CDPManagerService extends BaseService {
  private _walletManager?: WalletManagerService;
  private priceRepository: Repository<Price>;
  private cdpRepository: Repository<CollateralizedDebtPosition>;

  constructor() {
    super('CDPManagerService');
    this.priceRepository = {} as Repository<Price>;
    this.cdpRepository = {} as Repository<CollateralizedDebtPosition>;
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
      if (!lucidProvider.isInitialized()) {
        await lucidProvider.initialize();
      }
      await indigoParamsConfig.initialize();
      
      await initializeTypeORM();
      this.priceRepository = getRepository(Price);
      this.cdpRepository = getRepository(CollateralizedDebtPosition);
      
      this.logInitialization(true, { 
        lucidInitialized: lucidProvider.isInitialized(),
        indigoParamsInitialized: true,
        priceRepositoryInitialized: !!this.priceRepository,
        cdpRepositoryInitialized: !!this.cdpRepository
      });
    });
  }

  /**
   * Get current price for a specific asset using TypeORM
   */
  async getCurrentPrice(asset: string): Promise<IPriceData | null> {
    try {
      const priceRecord = await this.priceRepository
        .createQueryBuilder('price')
        .select(['price.asset', 'price.price', 'price.slot', 'price.createdAt', 'price.updatedAt', 'price.expiration'])
        .where('price.asset = :asset', { asset })
        .orderBy('price.slot', 'DESC')
        .limit(1)
        .getOne();

      if (!priceRecord) {
        const latestSlotResult = await this.priceRepository
          .createQueryBuilder('price')
          .select(['price.asset', 'price.slot'])
          .orderBy('price.slot', 'DESC')
          .limit(1)
          .getOne();
        
        logger.warn('No price data found for asset', { 
          asset,
          latestSlotInDB: latestSlotResult?.slot || 'no data',
          assetName: latestSlotResult?.asset || 'none'
        });
        return null;
      }

      return {
        asset: priceRecord.asset,
        price: BigInt(priceRecord.price),
        slot: priceRecord.slot,
        expiration: new Date(Number(priceRecord.expiration)),
      };

    } catch (error) {
      logger.error('❌ Failed to get latest price for asset:', { asset, error });
      return null;
    }
  }

  /**
   * Get current prices for all assets using TypeORM
   */
  async getCurrentPrices(): Promise<IAssetPrices | null> {
    try {
      const assets = ['iUSD', 'iBTC', 'iETH', 'iSOL'];
      const prices: any = {};
      let foundPrices = 0;

      for (const asset of assets) {
        const priceData = await this.getCurrentPrice(asset);
        if (priceData) {
          prices[asset] = priceData.price;
          foundPrices++;
        } else {
          const latestSlotResult = await this.priceRepository
            .createQueryBuilder('price')
            .select(['price.slot', 'price.asset'])
            .orderBy('price.slot', 'DESC')
            .limit(1)
            .getOne();
          
          prices[asset] = BigInt(0);
          logger.warn('No price data found for asset, using 0:', { 
            asset,
            latestSlotInDB: latestSlotResult?.slot || 'no data',
            assetName: latestSlotResult?.asset || 'none'
          });
        }
      }

      if (foundPrices === 0) {
        logger.error('❌ No price data found for any assets');
        return null;
      }

      return {
        iUSD: prices.iUSD,
        iBTC: prices.iBTC,
        iETH: prices.iETH,
        iSOL: prices.iSOL,
        timestamp: new Date(),
      };

    } catch (error) {
      logger.error('❌ Failed to get current prices:', error);
      return null;
    }
  }

  /**
   * Get CDPs by owner using TypeORM
   */
  async getCDPsByOwner(walletAddress: string): Promise<CollateralizedDebtPosition[]> {
    try {
      const paymentKeyHash = this.extractPaymentKeyHash(walletAddress);

      const whereConditions = [
        { owner: walletAddress, consumed: IsNull() }
      ];

      if (paymentKeyHash) {
        whereConditions.push({ owner: paymentKeyHash, consumed: IsNull() });
      }

      return await this.cdpRepository.find({
        where: whereConditions,
        order: { createdAt: 'DESC' },
      });

    } catch (error) {
      logger.error('❌ Error fetching active CDPs by owner:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      throw new Error(`Failed to get active CDPs for owner: ${error}`);
    }
  }

  /**
   * Extract payment key hash from bech32 address
   */
  private extractPaymentKeyHash(bech32Address: string): string | null {
    try {
      const addressDetails = getAddressDetails(bech32Address);
      
      if (addressDetails.paymentCredential?.hash) {
        return addressDetails.paymentCredential.hash;
      }
      
      logger.warn('No payment credential hash found in address', { 
        address: maskAddress(bech32Address) 
      });
      return null;

    } catch (error) {
      logger.error('❌ Failed to extract payment key hash from address:', { 
        address: maskAddress(bech32Address), 
        error 
      });
      return null;
    }
  }

  /**
   * Discover user's CDPs using Analytics DB (more reliable than UTXO scanning)
   */
  async getUserCDPs(walletAddress: string): Promise<ICDP[]> {
    return this.executeAsync('getUserCDPs', async () => {
      const cdpRecords = await this.getCDPsByOwner(walletAddress);
      
      const cdps: ICDP[] = cdpRecords.map(record => ({
        cdpId: `${record.outputHash}#${record.outputIndex}`,
        walletAddress: record.owner,
        assetType: record.asset,
        collateralAmount: record.collateralAmountAsBigInt,
        mintedAmount: record.mintedAmountAsBigInt,
        slot: record.slot,
        outputHash: record.outputHash,
        outputIndex: record.outputIndex,
        version: record.version || 'v1',
        lastUpdated: record.updatedAt || record.createdAt,
        currentCR: 0,
      }));

      return cdps;
    }, { walletAddress });
  }

  /**
   * Calculate current collateral ratio
   * CR = (collateral * 100) / (minted * assetPrice / 1M)
   */
  calculateCurrentCR(collateralAmount: bigint, mintedAmount: bigint, assetPrice: bigint): number {
    try {
      if (mintedAmount === BigInt(0) || assetPrice === BigInt(0)) {
        return 0;
      }

      const collateralValueLovelace = collateralAmount;
      const debtValueLovelace = (mintedAmount * assetPrice) / BigInt(1_000_000);

      if (debtValueLovelace === BigInt(0)) {
        return Number.MAX_SAFE_INTEGER;
      }

      const cr = Number(collateralValueLovelace * BigInt(100)) / Number(debtValueLovelace);

      return Math.round(cr * 100) / 100;

    } catch (error) {
      logger.error('❌ Failed to calculate current CR:', { error });
      return 0;
    }
  }

  /**
   * Withdraw collateral from CDP using Indigo SDK
   */
  async withdrawCollateral(cdpId: string, withdrawAmount: bigint, walletAddress: string): Promise<string> {
    return this.executeAsync('withdrawCollateral', async () => {
      const { lucid, systemParams, outRef } = await this.setupCDPTransaction(cdpId, walletAddress);

      const txBuilder = await IndigoSDK.CDPContract.withdraw(
        outRef,
        withdrawAmount,
        systemParams,
        lucid
      );

      await delay(20000);
      
      const signedTx = await this.walletManager.signTransaction(txBuilder, walletAddress);
      return await signedTx.submit();
    }, { 
      cdpId, 
      withdrawAmount: `${Number(withdrawAmount) / 1_000_000} ADA`,
      walletAddress 
    });
  }

  /**
   * Deposit collateral to CDP using Indigo SDK
   */
  async depositCollateral(cdpId: string, depositAmount: bigint, walletAddress: string): Promise<string> {
    return this.executeAsync('depositCollateral', async () => {
      const { lucid, systemParams, outRef } = await this.setupCDPTransaction(cdpId, walletAddress);

      const txBuilder = await IndigoSDK.CDPContract.deposit(
        outRef,
        depositAmount,
        systemParams,
        lucid
      );

      await delay(20000);
      
      const signedTx = await this.walletManager.signTransaction(txBuilder, walletAddress);
      return await signedTx.submit();
    }, { 
      cdpId, 
      depositAmount: `${Number(depositAmount) / 1_000_000} ADA`,
      walletAddress 
    });
  }

  /**
   * Setup common CDP transaction prerequisites
   */
  private async setupCDPTransaction(cdpId: string, walletAddress: string) {
    const lucid = lucidProvider.lucid;
    if (!lucid) {
      throw new Error('Lucid not initialized');
    }

    const systemParams = await indigoParamsConfig.getSystemParams();
    const [txHash, outputIndex] = cdpId.split('#');
    const outRef: OutRef = {
      txHash,
      outputIndex: parseInt(outputIndex)
    };

    try {
      const utxos = await lucid.utxosByOutRef([outRef]);
      const utxo = utxos[0];
      if (!utxo || !utxo.datum) {
        throw new Error(`CDP UTXO not found or has no datum at ${cdpId}. This CDP may have been consumed or the analytics DB has stale data.`);
      }
    } catch (error) {
      throw new Error(`Failed to fetch CDP UTXO at ${cdpId}: ${error instanceof Error ? error.message : String(error)}. The CDP may have been consumed or moved.`);
    }

    const seedphrase = await this.walletManager.getSeedphrase(walletAddress);
    if (!seedphrase) {
      throw new Error(`No seed phrase found for wallet: ${walletAddress}`);
    }
    
    lucid.selectWallet.fromSeed(seedphrase);

    try {
      const selectedWallet = lucid.wallet();
      if (!selectedWallet) {
        throw new Error('Wallet selection failed - wallet() returned undefined');
      }
    } catch (verificationError) {
      throw new Error(`Wallet verification failed for Indigo SDK: ${verificationError}`);
    }

    return { lucid, systemParams, outRef };
  }

  /**
   * Calculate required collateral adjustment
   */
  calculateCollateralAdjustment(
    currentCollateral: bigint,
    mintedAmount: bigint,
    assetPrice: bigint,
    targetCR: number
  ): { adjustmentAmount: bigint; newCR: number } {
    try {
      if (mintedAmount === BigInt(0) || assetPrice === BigInt(0)) {
        return { adjustmentAmount: BigInt(0), newCR: 0 };
      }

      const debtValueLovelace = (mintedAmount * assetPrice) / BigInt(1_000_000);
      const targetCollateral = (debtValueLovelace * BigInt(Math.round(targetCR * 100))) / BigInt(100 * 100);
      
      const adjustmentAmount = targetCollateral - currentCollateral;
      const newCR = this.calculateCurrentCR(targetCollateral, mintedAmount, assetPrice);

      return {
        adjustmentAmount,
        newCR
      };

    } catch (error) {
      logger.error('❌ Failed to calculate collateral adjustment:', { error });
      return { adjustmentAmount: BigInt(0), newCR: 0 };
    }
  }

}