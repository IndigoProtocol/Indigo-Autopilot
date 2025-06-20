import lucidProvider from '../config/lucid';
import {IWalletData} from '@cdp-bot/shared';
import logger from '../utils/logger';
import * as crypto from 'crypto';
import { maskAddress } from '../utils/common.js';
import { BaseService } from './base-service.js';

export class WalletManagerService extends BaseService {
  private walletCache: Map<string, IWalletData> = new Map();

  constructor() {
    super('WalletManagerService');
  }

  async initialize(): Promise<void> {
    return this.executeAsyncInitialize(async () => {
      this.logInitialization(true, { cacheSize: this.walletCache.size });
    });
  }

  /**
   * Store seed phrase for a wallet address in environment variables
   */
  async storeSeedphrase(walletAddress: string, seedphrase: string): Promise<void> {
    return this.executeAsync('storeSeedphrase', async () => {
      const words = seedphrase.trim().split(' ');
      if (words.length !== 24) {
        throw new Error('Invalid seed phrase: must be 24 words');
      }

      const encryptedSeedphrase = this.encryptSeedphrase(seedphrase);
      
      const envKey = `WALLET_SEEDPHRASE_${walletAddress}`;
      process.env[envKey] = encryptedSeedphrase;
      
      const walletData: IWalletData = {
        address: walletAddress,
        seedphrase: encryptedSeedphrase
      };
      
      this.walletCache.set(walletAddress, walletData);
      
      logger.info('Seed phrase stored successfully', { 
        walletAddress: maskAddress(walletAddress),
        envKey 
      });
    }, { walletAddress });
  }

  /**
   * Retrieve seed phrase for a wallet address from environment variables
   */
  async getSeedphrase(walletAddress: string): Promise<string | null> {
    try {
      let walletData = this.walletCache.get(walletAddress);

      if (!walletData) {
        walletData = await this.loadWalletFromEnv(walletAddress);
        if (walletData) {
          this.walletCache.set(walletAddress, walletData);
        }
      }

      if (!walletData) {
        throw new Error('Wallet not found in cache or environment');
      }

      return this.decryptSeedphrase(walletData.seedphrase);

    } catch (error) {
      logger.error('Failed to retrieve seed phrase:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      return null;
    }
  }

  async getWalletBalance(walletAddress: string): Promise<{ lovelace: bigint; ada: number }> {
    try {
      const lucid = lucidProvider.lucid;
      if (!lucid) {
        throw new Error('Lucid not initialized');
      }
      
      const utxos = await lucid.utxosAt(walletAddress);
      
      if (!utxos || utxos.length === 0) {
        logger.info('No UTXOs found for wallet', { 
          walletAddress: maskAddress(walletAddress) 
        });
        return { lovelace: BigInt(0), ada: 0 };
      }

      const totalLovelace = utxos.reduce((sum: bigint, utxo: any) => {
        return sum + BigInt(utxo.assets.lovelace);
      }, BigInt(0));

      const adaAmount = Number(totalLovelace) / 1_000_000;

      logger.info('Wallet balance retrieved', {
        walletAddress: maskAddress(walletAddress),
        balance: `${adaAmount.toFixed(6)} ADA`
      });

      return { lovelace: totalLovelace, ada: adaAmount };

    } catch (error) {
      logger.error('Failed to get wallet balance:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      throw new Error(`Failed to get wallet balance: ${error}`);
    }
  }

  private async loadWalletFromEnv(walletAddress: string): Promise<IWalletData | undefined> {
    try {
      const seedPhraseKey = `WALLET_SEEDPHRASE_${walletAddress}`;

      const encryptedSeedphrase = process.env[seedPhraseKey];

      if (!encryptedSeedphrase) {
        logger.error('❌ No seed phrase found in environment', {
          walletAddress: maskAddress(walletAddress),
          envKey: seedPhraseKey.substring(0, 30) + '...',
          allEnvKeys: Object.keys(process.env).filter(k => k.startsWith('WALLET_')).map(k => k.substring(0, 30) + '...')
        });
        return undefined;
      }

      return {
        address: walletAddress,
        seedphrase: encryptedSeedphrase
      };

    } catch (error) {
      logger.error('Failed to load wallet from environment:', {
        walletAddress: maskAddress(walletAddress),
        error
      });
      return undefined;
    }
  }

  /**
   * Sign a transaction using the stored seed phrase for a wallet
   */
  async signTransaction(txBuilder: any, walletAddress: string): Promise<any> {
    try {
      let signedTx;

      try {
        if (typeof txBuilder.complete === 'function' && !txBuilder.sign) {

          const txSignBuilder = await txBuilder.complete();


          if (txSignBuilder.sign && typeof txSignBuilder.sign.withWallet === 'function') {
            const signBuilder = txSignBuilder.sign.withWallet();
            signedTx = await signBuilder.complete();
          } else {
            throw new Error(`TxSignBuilder missing sign.withWallet(). Available methods: ${Object.keys(txSignBuilder || {}).join(', ')}`);
          }
        }
        else if (txBuilder.sign && typeof txBuilder.sign.withWallet === 'function') {
          const signBuilder = txBuilder.sign.withWallet();
          signedTx = await signBuilder.complete();
        }
        else {
          throw new Error(`Unsupported transaction builder. Expected TxBuilder with complete() or TxSignBuilder with sign.withWallet(). Available methods: ${Object.keys(txBuilder || {}).join(', ')}`);
        }
      } catch (signingError) {
        logger.error('❌ Transaction signing method failed', {
          error: signingError instanceof Error ? signingError.message : String(signingError),
        });
        throw signingError;
      }

      return signedTx;

    } catch (error) {
      logger.error('Failed to sign transaction:', {
        walletAddress: maskAddress(walletAddress),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to sign transaction: ${error}`);
    }
  }

  /**
   * Remove seed phrase from storage
   */
  async removeSeedphrase(walletAddress: string): Promise<boolean> {
    try {
      const envKey = `WALLET_SEEDPHRASE_${walletAddress}`;
      
      delete process.env[envKey];
      
      this.walletCache.delete(walletAddress);
      
      logger.info('Seed phrase removed successfully', { 
        walletAddress: maskAddress(walletAddress) 
      });
      
      return true;

    } catch (error) {
      logger.error('Failed to remove seed phrase:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      return false;
    }
  }

  /**
   * List all managed wallets (without seed phrases)
   */
  getManagedWallets(): Omit<IWalletData, 'seedphrase'>[] {
    return Array.from(this.walletCache.values()).map(wallet => ({
      address: wallet.address
    }));
  }

  /**
   * Check if a wallet is managed (has seed phrase available)
   */
  async isWalletManaged(walletAddress: string): Promise<boolean> {
    try {
      const seedphrase = await this.getSeedphrase(walletAddress);
      return seedphrase !== null && seedphrase !== undefined;
    } catch (error) {
      return false;
    }
  }

  /**
   * Encrypt seed phrase using AES-256-CBC
   */
  private encryptSeedphrase(seedphrase: string): string {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      let encrypted = cipher.update(seedphrase, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const result = iv.toString('hex') + ':' + encrypted;
      
      return result;

    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt seed phrase');
    }
  }

  /**
   * Decrypt seed phrase using AES-256-CBC
   */
  private decryptSeedphrase(encryptedSeedphrase: string): string {
    try {
      if (!encryptedSeedphrase.includes(':') && encryptedSeedphrase.includes(' ')) {
        return encryptedSeedphrase;
      }

      const key = this.getEncryptionKey();
      const [ivHex, encryptedHex] = encryptedSeedphrase.split(':');
      
      if (!ivHex || !encryptedHex) {
        throw new Error('Invalid encrypted seed phrase format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;

    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt seed phrase');
    }
  }

  /**
   * Get encryption key from environment
   */
  private getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY not found in environment variables');
    }
    
    return crypto.scryptSync(key, 'cdp-management-salt', 32);
  }
} 