#!/usr/bin/env tsx
import { WalletManagerService } from '../services/wallet-manager.service';
import { IUserStrategy } from '@cdp-bot/shared';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common.js';
import { addWalletToEnv, removeStrategyFromEnv } from '../utils/strategy-env.js';

/**
 * Interactive script to help users set up their wallet and strategy
 * TODO: This script needs to be updated to work with the current system
 */

interface WalletSetup {
  seedPhrase: string;
  strategy: IUserStrategy;
}

class WalletSetup {
  private walletManager: WalletManagerService;

  constructor() {
    this.walletManager = new WalletManagerService();
  }

  /**
   * Add a new wallet and strategy configuration
   */
  async addWallet(seedPhrase: string, strategyConfig: Partial<IUserStrategy>): Promise<string> {
    try {
      const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
      
      const provider = new Blockfrost(
        'https://cardano-mainnet.blockfrost.io/api/v0',
        process.env.BLOCKFROST_PROJECT_ID || 'mainnetDefaultKey'
      );
      
      const tempLucid = await Lucid(provider, 'Mainnet');
      tempLucid.selectWallet.fromSeed(seedPhrase);
      const wallet = tempLucid.wallet();
      const walletAddress = await wallet.address();
      
      await this.walletManager.storeSeedphrase(walletAddress, seedPhrase);

      const strategy: IUserStrategy = {
        walletAddress,
        enabled: strategyConfig.enabled ?? true,
        targetCR: strategyConfig.targetCR ?? 160,
        minCR: strategyConfig.minCR ?? 140,
        maxCR: strategyConfig.maxCR ?? 180,
      };

      await addWalletToEnv(walletAddress, seedPhrase, strategy);
      
      logger.info('✅ Wallet and strategy configured successfully!', {
        walletAddress: maskAddress(walletAddress),
        strategy: {
          enabled: strategy.enabled,
          targetCR: strategy.targetCR,
        }
      });

      return walletAddress;

    } catch (error) {
      logger.error('❌ Failed to setup wallet:', error);
      throw error;
    }
  }

  /**
   * List configured wallets
   */
  listConfiguredWallets(): void {
    const wallets = this.walletManager.getManagedWallets();
    
    if (wallets.length === 0) {
      logger.info('No wallets configured yet.');
      return;
    }
  }

  /**
   * Remove a wallet configuration
   */
  async removeWallet(walletAddress: string): Promise<boolean> {
    try {
      const removed = await this.walletManager.removeSeedphrase(walletAddress);
      
      if (removed) {
        await removeStrategyFromEnv(walletAddress);
        logger.info('✅ Wallet removed successfully', {
          walletAddress: maskAddress(walletAddress)
        });
      }
      
      return removed;

    } catch (error) {
      logger.error('❌ Failed to remove wallet:', error);
      return false;
    }
  }
}

async function main() {
  const setup = new WalletSetup();
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'add':
        if (args.length < 2) {
          console.log('Usage: npm run setup-wallet add "<seed phrase>" [options]');
          console.log('Example: npm run setup-wallet add "word1 word2 word3..." --target-cr=160 --assets=iUSD,iBTC');
          process.exit(1);
        }

        const seedPhrase = args[1];
        const strategyOptions: Partial<IUserStrategy> = {};

        // Parse options
        for (let i = 2; i < args.length; i++) {
          const arg = args[i];
          if (arg.startsWith('--target-cr=')) {
            strategyOptions.targetCR = parseInt(arg.split('=')[1]);
          } else if (arg.startsWith('--min-cr=')) {
            strategyOptions.minCR = parseInt(arg.split('=')[1]);
          } else if (arg.startsWith('--max-cr=')) {
            strategyOptions.maxCR = parseInt(arg.split('=')[1]);
          }
        }

        const walletAddress = await setup.addWallet(seedPhrase, strategyOptions);
        console.log(`✅ Wallet configured: ${walletAddress}`);
        break;

      case 'list':
        setup.listConfiguredWallets();
        break;

      case 'remove':
        if (args.length < 2) {
          console.log('Usage: npm run setup-wallet remove <wallet_address>');
          process.exit(1);
        }
        
        const removed = await setup.removeWallet(args[1]);
        if (removed) {
          console.log('✅ Wallet removed successfully');
        } else {
          console.log('❌ Failed to remove wallet');
        }
        break;

      default:
        console.log('CDP Bot Wallet Setup');
        console.log('Commands:');
        console.log('  add "<seed phrase>" [options] - Add a new wallet');
        console.log('  list                          - List configured wallets');
        console.log('  remove <wallet_address>       - Remove a wallet');
        console.log('');
        console.log('Options for add command:');
        console.log('  --target-cr=160    - Target collateral ratio (default: 160%)');
        console.log('  --min-cr=140       - Minimum CR (default: 140%)');
        console.log('  --max-cr=180       - Maximum CR (default: 180%)');
        break;
    }

  } catch (error) {
    logger.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => {
    console.log('Setup completed');
    process.exit(0);
  }).catch((error) => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

export { WalletSetup }; 