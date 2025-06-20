import { Blockfrost, Lucid } from '@lucid-evolution/lucid';
import CONFIG from '../config';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common.js';
import { BaseService } from './base-service.js';

export class BalanceService extends BaseService {
  private lucid!: Awaited<ReturnType<typeof Lucid>>;

  constructor() {
    super('BalanceService');
  }

  public static async getInstance(): Promise<BalanceService> {
    const instance = new BalanceService();
    await instance.initialize();
    return instance;
  }

  async initialize(): Promise<void> {
    return this.executeAsyncInitialize(async () => {
      if (!CONFIG.BLOCKFROST_PROJECT_ID) {
        throw new Error('Blockfrost Project ID is not configured');
      }

      this.lucid = await Lucid(
        new Blockfrost(CONFIG.BLOCKFROST_URL, CONFIG.BLOCKFROST_PROJECT_ID),
        'Mainnet'
      );

      const currentSlot = await this.lucid.currentSlot();
      this.logInitialization(true, { 
        currentSlot,
        network: 'Mainnet',
        blockfrostConfigured: !!CONFIG.BLOCKFROST_PROJECT_ID
      });
    });
  }

  public async getWalletAssets(address: string): Promise<{ [assetId: string]: bigint }> {
    try {
      const utxos = await this.lucid.utxosAt(address);
      
      if (!utxos || utxos.length === 0) {
        return {};
      }

      const assets: { [assetId: string]: bigint } = {};

      utxos.forEach(utxo => {
        Object.entries(utxo.assets).forEach(([assetId, amount]) => {
          assets[assetId] = (assets[assetId] || BigInt(0)) + BigInt(amount);
        });
      });

      return assets;

    } catch (error) {
      logger.error(`❌ Error fetching wallet assets for ${maskAddress(address)}: ${error}`);
      throw new Error(`Failed to get wallet assets: ${error}`);
    }
  }
} 