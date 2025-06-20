import {Blockfrost, Lucid, Network} from '@lucid-evolution/lucid';
import CONFIG from './index';
import logger from '../utils/logger';

export interface ILucidProvider {
  lucid: any | null;
  initialize(): Promise<void>;
  isInitialized(): boolean;
  getNetworkParams(): Promise<any>;
}

class LucidProvider implements ILucidProvider {
  public lucid: any | null = null;

  async initialize(): Promise<void> {
    try {
      if (!CONFIG.BLOCKFROST_PROJECT_ID) {
        throw new Error('BLOCKFROST_PROJECT_ID is required');
      }

      const provider = new Blockfrost(CONFIG.BLOCKFROST_URL, CONFIG.BLOCKFROST_PROJECT_ID);
      const network = CONFIG.CARDANO_NETWORK as Network;
      this.lucid = await Lucid(provider, network);
    } catch (error) {
      logger.error('Failed to initialize Lucid Evolution:', error);
      throw new Error(`Lucid initialization failed: ${error}`);
    }
  }

  isInitialized(): boolean {
    return this.lucid !== null;
  }

  async getNetworkParams(): Promise<any> {
    if (!this.lucid) {
      throw new Error('Lucid not initialized. Call initialize() first.');
    }
    
    try {
      const provider = this.lucid.provider;
      return await provider.getProtocolParameters();
    } catch (error) {
      logger.error('Failed to get network parameters:', error);
      throw error;
    }
  }
}

export const lucidProvider = new LucidProvider();
export default lucidProvider; 