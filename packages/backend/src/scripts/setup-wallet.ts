#!/usr/bin/env tsx
import { WalletManagerService } from '../services';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common';
import { removeStrategyFromEnv } from '../utils/strategy-env';
import { storeSeedphrase } from '../utils/wallet-utils';

/**
 * Interactive script to help users set up their wallet and strategy
 * TODO: This script needs to be updated to work with the current system
 */

class WalletSetup {
  private walletManager: WalletManagerService;

  constructor() {
    this.walletManager = new WalletManagerService();
  }

  /**
   * Add a new wallet and strategy configuration
   */
  async addWallet(seedPhrase: string): Promise<string> {
    try {
      const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
      
      const provider = new Blockfrost(
        'https://cardano-mainnet.blockfrost.io/api/v0',
        process.env.BLOCKFROST_PROJECT_ID
      );
      
      const tempLucid = await Lucid(provider, 'Mainnet');
      tempLucid.selectWallet.fromSeed(seedPhrase);
      const wallet = tempLucid.wallet();
      const walletAddress = await wallet.address();
      
      await storeSeedphrase(walletAddress, seedPhrase);
      
      logger.info('✅ Wallet configured successfully! Use the strategy CLI to create strategies.', {
        walletAddress: maskAddress(walletAddress)
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
          console.log('Usage: npm run setup-wallet add "<seed phrase>"');
          console.log('Example: npm run setup-wallet add "word1 word2 word3..."');
          process.exit(1);
        }

        const seedPhrase = args[1];
        const walletAddress = await setup.addWallet(seedPhrase);
        console.log(`✅ Wallet configured: ${walletAddress}`);
        console.log('💡 Next: Use "npm run strategy-cli update" to configure strategies for this wallet.');
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
        console.log('  add "<seed phrase>"     - Add a new wallet (seed phrase only)');
        console.log('  list                    - List configured wallets');
        console.log('  remove <wallet_address> - Remove a wallet');
        console.log('');
        console.log('Note: After adding a wallet, use the strategy CLI to configure strategies:');
        console.log('  npm run strategy-cli update --wallet=<address> --assets=<assets> --target-cr=<cr>');
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