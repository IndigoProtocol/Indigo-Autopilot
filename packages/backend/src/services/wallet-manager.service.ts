import lucidProvider from '../config/lucid';
import { IWalletData } from '@cdp-bot/shared';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common';
import { BaseService } from './base-service';
import { CML, fromHex, coreToUtxo } from '@lucid-evolution/lucid';
import { 
  normalizeAddress, 
  categorizeAddress, 
  AddressType, 
  tryDecodeHex
} from '../utils/address-utils.js';
import {
  storeSeedphrase as storeWalletSeedphrase,
  getSeedphrase as getWalletSeedphrase,
  removeSeedphrase as removeWalletSeedphrase,
  loadWalletFromEnv
} from '../utils/wallet-utils.js';

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
      await storeWalletSeedphrase(walletAddress, seedphrase);
      
      const walletData = await loadWalletFromEnv(walletAddress);
      if (walletData) {
        this.walletCache.set(walletAddress, walletData);
      }
    }, { walletAddress });
  }

  /**
   * Retrieve seed phrase for a wallet address from environment variables
   */
  async getSeedphrase(walletAddress: string): Promise<string | null> {
    try {
      let walletData = this.walletCache.get(walletAddress);

      if (!walletData) {
        walletData = await loadWalletFromEnv(walletAddress);
        if (walletData) {
          this.walletCache.set(walletAddress, walletData);
        }
      }

      if (!walletData) {
        return null;
      }

      return await getWalletSeedphrase(walletAddress);

    } catch (error) {
      logger.error('❌ Failed to retrieve seed phrase:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      return null;
    }
  }

  async getWalletBalance(walletAddress: string): Promise<{ lovelace: bigint; ada: number; tokens?: Record<string, any> }> {
    try {
      const addressType = categorizeAddress(walletAddress);
      let processedAddress = walletAddress;
      
      if (addressType !== AddressType.BECH32_BASE && addressType !== AddressType.BECH32_ENTERPRISE) {
        processedAddress = normalizeAddress(walletAddress);
      }
      
      const lucid = lucidProvider.lucid;
      if (!lucid) {
        throw new Error('WalletManagerService: Lucid not initialized');
      }
      
      const utxos = await lucid.utxosAt(processedAddress);
      
      if (!utxos || utxos.length === 0) {
        return { lovelace: BigInt(0), ada: 0, tokens: {} };
      }

      const validatedUtxos = this.validateAndParseUtxos(utxos);
      let totalLovelace = BigInt(0);
      const tokenBalances: Record<string, bigint> = {};
      
      for (const utxo of validatedUtxos) {
        if (utxo.assets.lovelace) {
          const lovelaceAmount = typeof utxo.assets.lovelace === 'bigint' 
            ? utxo.assets.lovelace 
            : BigInt(String(utxo.assets.lovelace));
          totalLovelace += lovelaceAmount;
        }

        for (const [assetId, amount] of Object.entries(utxo.assets)) {
          if (assetId === 'lovelace') continue;
          
          const tokenAmount = typeof amount === 'bigint' ? amount : BigInt(String(amount));
          tokenBalances[assetId] = (tokenBalances[assetId] || BigInt(0)) + tokenAmount;
        }
      }

      const adaAmount = Number(totalLovelace) / 1_000_000;
      const formattedTokens: Record<string, any> = {};
      
      for (const [assetId, amount] of Object.entries(tokenBalances)) {
        if (amount > 0n) {
          const policyId = assetId.slice(0, 56);
          const assetName = assetId.slice(56);
          
          formattedTokens[assetId] = {
            policyId,
            assetName,
            decodedName: tryDecodeHex(assetName),
            amount: amount.toString()
          };
        }
      }

      return { 
        lovelace: totalLovelace, 
        ada: adaAmount,
        tokens: formattedTokens
      };

    } catch (error) {
      throw new Error(`WalletManagerService.getWalletBalance failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate and parse UTxOs, handling different formats
   */
  private validateAndParseUtxos(utxos: any[]): any[] {
    if (!utxos || !Array.isArray(utxos) || utxos.length === 0) {
      return [];
    }

    const validatedUtxos = utxos.map((utxo, _index) => {
      if (!utxo) {
        return null;
      }

      if (typeof utxo === 'string') {
        const utxoObject = CML.TransactionUnspentOutput.from_cbor_bytes(fromHex(utxo));
        return coreToUtxo(utxoObject);
      }

      if (!utxo.txHash || utxo.outputIndex === undefined || !utxo.assets) {
        return null;
      }
      
      const formattedAssets: { [key: string]: bigint } = {};
      
      for (const [assetId, amount] of Object.entries(utxo.assets || {})) {
        if (amount === undefined || amount === null) {
          formattedAssets[assetId] = BigInt(0);
        } else {
          formattedAssets[assetId] = typeof amount === 'bigint' ? amount : BigInt(String(amount));
        }
      }

      return {
        ...utxo,
        assets: formattedAssets
      };
    }).filter(Boolean);

    return validatedUtxos;
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
      logger.error('❌ Failed to sign transaction:', {
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
      const success = await removeWalletSeedphrase(walletAddress);
      
      if (success) {
        this.walletCache.delete(walletAddress);
      }
      
      return success;

    } catch (error) {
      logger.error('❌ Failed to remove seed phrase:', { 
        walletAddress: maskAddress(walletAddress), 
        error 
      });
      return false;
    }
  }

  /**
   * List all managed wallets
   */
  getManagedWallets(): Omit<IWalletData, 'seedphrase'>[] {
    return Array.from(this.walletCache.values()).map(wallet => ({
      address: wallet.address
    }));
  }

  /**
   * Check if a wallet is managed
   */
  async isWalletManaged(walletAddress: string): Promise<boolean> {
    try {
      const seedphrase = await this.getSeedphrase(walletAddress);
      return seedphrase !== null && seedphrase !== undefined;
    } catch (_error) {
      return false;
    }
  }
} 