#!/usr/bin/env tsx
import { WalletManagerService } from '../services/wallet-manager.service.js';
import { CDPManagerService } from '../services/cdp-manager.service.js';
import { IUserStrategy } from '@cdp-bot/shared';
import logger from '../utils/logger.js';
import { maskAddress } from '../utils/common.js';
import { loadStrategyFromEnv, updateStrategyInEnv, removeStrategyFromEnv } from '../utils/strategy-env.js';
import { getService, initializeAllServices } from '../services/index.js';

/**
 * CLI tool for strategy management
 * Usage: npm run strategy-cli <command> [options]
 */

interface StrategyConfig {
  enabled?: boolean;
  targetCR?: number;
  minCR?: number;
  maxCR?: number;
  enabledAssets?: string[];
}

class StrategyCLI {
  private walletManager: WalletManagerService;
  private cdpManager: CDPManagerService;

  constructor() {
    this.walletManager = getService<WalletManagerService>('WalletManagerService');
    this.cdpManager = getService<CDPManagerService>('CDPManagerService');
  }

  /**
   * Update strategy for a wallet
   */
  async updateStrategy(walletAddress: string, config: StrategyConfig): Promise<void> {
    try {
      const isManaged = await this.walletManager.isWalletManaged(walletAddress);
      if (!isManaged) {
        throw new Error(`Wallet ${maskAddress(walletAddress)} is not managed`);
      }

      const currentStrategy = loadStrategyFromEnv(walletAddress);
      
      const updatedStrategy: IUserStrategy = {
        walletAddress,
        enabled: config.enabled ?? currentStrategy?.enabled ?? true,
        targetCR: config.targetCR ?? currentStrategy?.targetCR ?? 160,
        minCR: config.minCR ?? currentStrategy?.minCR ?? 140,
        maxCR: config.maxCR ?? currentStrategy?.maxCR ?? 180,
        enabledAssets: config.enabledAssets ?? currentStrategy?.enabledAssets ?? ['iUSD'],
      };

      await updateStrategyInEnv(walletAddress, updatedStrategy);

      logger.info('✅ Strategy updated successfully', {
        walletAddress: maskAddress(walletAddress),
        strategy: updatedStrategy
      });

      console.log(`✅ Strategy updated for wallet: ${maskAddress(walletAddress)}`);
      console.log(`   Enabled: ${updatedStrategy.enabled}`);
      console.log(`   Target CR: ${updatedStrategy.targetCR}%`);
      console.log(`   Min CR: ${updatedStrategy.minCR}%`);
      console.log(`   Max CR: ${updatedStrategy.maxCR}%`);
      console.log(`   Assets: ${updatedStrategy.enabledAssets?.join(', ') || 'None'}`);
      
      console.log('\n🤖 Bot will automatically manage:');
      console.log(`   📊 Assets: ${updatedStrategy.enabledAssets?.join(', ') || 'None'}`);
      console.log(`   📈 DEPOSIT collateral when CR < ${updatedStrategy.minCR}%`);
      console.log(`   📉 WITHDRAW collateral when CR > ${updatedStrategy.maxCR}%`);
      console.log(`   🎯 Target CR: ${updatedStrategy.targetCR}%`);

    } catch (error) {
      logger.error('❌ Failed to update strategy:', error);
      throw error;
    }
  }

  /**
   * Get strategy status for a wallet
   */
  async getStrategy(walletAddress: string): Promise<void> {
    try {
      const isManaged = await this.walletManager.isWalletManaged(walletAddress);
      if (!isManaged) {
        throw new Error(`Wallet ${maskAddress(walletAddress)} is not managed`);
      }

      const strategy = loadStrategyFromEnv(walletAddress);
      if (!strategy) {
        console.log(`No strategy configured for wallet: ${maskAddress(walletAddress)}`);
        return;
      }

      console.log(`\n📊 Strategy for wallet: ${maskAddress(walletAddress)}`);
      console.log(`   Status: ${strategy.enabled ? '✅ Enabled' : '❌ Disabled'}`);
      console.log(`   Target CR: ${strategy.targetCR}%`);
      console.log(`   Min CR: ${strategy.minCR}% (triggers DEPOSIT)`);
      console.log(`   Max CR: ${strategy.maxCR}% (triggers WITHDRAWAL)`);
      console.log(`   Assets: ${strategy.enabledAssets?.join(', ') || 'All assets'}`);
      
      if (!strategy.enabled) {
        console.log('\n⚠️  Strategy is disabled - bot will not manage CDPs');
        return;
      }

      const cdps = await this.cdpManager.getUserCDPs(walletAddress);
      if (cdps.length > 0) {
        console.log(`\n📋 Current CDPs (${cdps.length}):`);
        
        const currentPrices = await this.cdpManager.getCurrentPrices();
        if (currentPrices) {
          cdps.forEach((cdp, index) => {
            try {
              const isAssetEnabled = !strategy.enabledAssets || strategy.enabledAssets.includes(cdp.assetType);
              
              const assetPriceData = currentPrices[cdp.assetType as keyof typeof currentPrices];
              const assetPrice = (typeof assetPriceData === 'bigint') ? assetPriceData : currentPrices.iUSD;
              const currentCR = this.cdpManager.calculateCurrentCR(
                cdp.collateralAmount,
                cdp.mintedAmount,
                assetPrice
              );
              
              console.log(`   CDP ${index + 1}:`);
              console.log(`     Asset: ${cdp.assetType} ${isAssetEnabled ? '✅' : '❌ Not managed'}`);
              console.log(`     Collateral: ${(Number(cdp.collateralAmount) / 1_000_000).toFixed(6)} ADA`);
              console.log(`     Minted: ${(Number(cdp.mintedAmount) / 1_000_000).toFixed(6)} ${cdp.assetType}`);
              console.log(`     Current CR: ${currentCR.toFixed(2)}%`);
              
              if (!isAssetEnabled) {
                console.log(`     ⚪ Bot will: NOT MANAGE (asset not in strategy)`);
              } else if (currentCR > strategy.maxCR) {
                console.log(`     🔴 Bot will: WITHDRAW collateral (CR > ${strategy.maxCR}%)`);
              } else if (currentCR < strategy.minCR) {
                console.log(`     🟡 Bot will: DEPOSIT collateral (CR < ${strategy.minCR}%)`);
              } else {
                console.log(`     🟢 Bot will: NO ACTION (CR within range)`);
              }
              
            } catch (error) {
              console.log(`     Error calculating CR: ${error instanceof Error ? error.message : String(error)}`);
            }
          });
        }
      } else {
        console.log('\n📋 No CDPs found for this wallet');
      }

    } catch (error) {
      logger.error('❌ Failed to get strategy:', error);
      throw error;
    }
  }

  /**
   * Remove strategy for a wallet
   */
  async removeStrategy(walletAddress: string): Promise<void> {
    try {
      const isManaged = await this.walletManager.isWalletManaged(walletAddress);
      if (!isManaged) {
        throw new Error(`Wallet ${maskAddress(walletAddress)} is not managed`);
      }

      await removeStrategyFromEnv(walletAddress);
      
      console.log(`✅ Strategy removed for wallet: ${maskAddress(walletAddress)}`);
      console.log('🤖 Bot will no longer manage CDPs for this wallet');

    } catch (error) {
      logger.error('❌ Failed to remove strategy:', error);
      throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    await initializeAllServices();
    
    const cli = new StrategyCLI();

    switch (command) {
      case 'update':
        if (args.length < 2) {
          console.log('Usage: npm run strategy-cli update <wallet_address> [options]');
          console.log('Options:');
          console.log('  --enabled=true|false    - Enable/disable strategy');
          console.log('  --target-cr=160         - Target collateral ratio (%)');
          console.log('  --min-cr=140           - Minimum CR - bot deposits when below (%)');
          console.log('  --max-cr=180           - Maximum CR - bot withdraws when above (%)');
          console.log('  --assets=iUSD,iBTC      - Assets to manage (comma-separated)');
          console.log('');
          console.log('Examples:');
          console.log('  npm run strategy-cli update addr123... --target-cr=200 --min-cr=180 --max-cr=220');
          console.log('  npm run strategy-cli update addr123... --assets=iUSD,iBTC --enabled=true');
          console.log('  npm run strategy-cli update addr123... --enabled=false');
          process.exit(1);
        }

        const walletAddress = args[1];
        const config: StrategyConfig = {};

        for (let i = 2; i < args.length; i++) {
          const arg = args[i];
          
          if (arg.startsWith('--enabled=')) {
            config.enabled = arg.split('=')[1] === 'true';
          } else if (arg.startsWith('--target-cr=')) {
            config.targetCR = parseInt(arg.split('=')[1]);
          } else if (arg.startsWith('--min-cr=')) {
            config.minCR = parseInt(arg.split('=')[1]);
          } else if (arg.startsWith('--max-cr=')) {
            config.maxCR = parseInt(arg.split('=')[1]);
          } else if (arg.startsWith('--assets=')) {
            config.enabledAssets = arg.split('=')[1].split(',').map(asset => asset.trim());
          }
        }

        await cli.updateStrategy(walletAddress, config);
        break;

      case 'get':
        if (args.length < 2) {
          console.log('Usage: npm run strategy-cli get <wallet_address>');
          process.exit(1);
        }

        await cli.getStrategy(args[1]);
        break;

      case 'remove':
        if (args.length < 2) {
          console.log('Usage: npm run strategy-cli remove <wallet_address>');
          process.exit(1);
        }

        await cli.removeStrategy(args[1]);
        break;

      default:
        console.log('CDP Bot Strategy CLI');
        console.log('\nCommands:');
        console.log('  update <address> [options]  - Update strategy configuration');
        console.log('  get <address>               - Get strategy status and CDP analysis');
        console.log('  remove <address>            - Remove strategy configuration');
        console.log('');
        console.log('Strategy Parameters:');
        console.log('  --target-cr=160      - Target CR% (where bot aims to maintain)');
        console.log('  --min-cr=140         - Min CR% (bot deposits when CR falls below)');
        console.log('  --max-cr=180         - Max CR% (bot withdraws when CR rises above)');
        console.log('  --assets=iUSD,iBTC   - Assets to manage (comma-separated)');
        console.log('  --enabled=true       - Enable/disable automated management');
        console.log('');
        console.log('Examples:');
        console.log('  npm run strategy-cli update addr123... --target-cr=200 --min-cr=180 --max-cr=220');
        console.log('  npm run strategy-cli update addr123... --assets=iUSD,iBTC --enabled=true');
        console.log('  npm run strategy-cli update addr123... --assets=iUSD --target-cr=160');
        console.log('  npm run strategy-cli get addr123...');
        console.log('  npm run strategy-cli remove addr123...');
        console.log('');
        console.log('Asset Management:');
        console.log('  🎯 Specify assets to manage with --assets flag');
        console.log('  📊 Available assets: iUSD, iBTC, iETH, iSOL');
        console.log('  ⚪ CDPs with unspecified assets will not be managed');
        console.log('');
        console.log('How it works:');
        console.log('  🤖 Bot automatically monitors enabled strategies for specified assets');
        console.log('  📈 When CR < minCR → Bot deposits collateral to reach targetCR');
        console.log('  📉 When CR > maxCR → Bot withdraws collateral to reach targetCR');
        console.log('  ⚖️  When minCR ≤ CR ≤ maxCR → Bot takes no action');
        break;
    }

  } catch (error) {
    logger.error('❌ CLI operation failed:', error);
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => {
    console.log('\n✅ Operation completed');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ Operation failed:', error);
    process.exit(1);
  });
}

export { StrategyCLI }; 