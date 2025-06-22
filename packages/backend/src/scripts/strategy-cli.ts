#!/usr/bin/env tsx
import { WalletManagerService, CDPManagerService, getService, initializeAllServices } from '../services';
import { IUserStrategy } from '@cdp-bot/shared';
import logger from '../utils/logger';
import { maskAddress } from '../utils/common';
import { loadStrategyFromEnv, updateStrategyInEnv, removeStrategyFromEnv } from '../utils/strategy-env';

/**
 * CLI tool for strategy management
 * Usage: npm run strategy-cli <command> [options]
 */

interface StrategyConfig {
  enabled?: boolean;
  targetCR?: number;
  minCR?: number;
  maxCR?: number;
  assets?: string[];
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
      
      if (!config.assets || config.assets.length === 0) {
        throw new Error('Assets must be specified with --assets=iUSD,iBTC,etc');
      }

      const updatedStrategy: IUserStrategy = {
        walletAddress,
        enabled: config.enabled ?? currentStrategy?.enabled ?? true,
        assetStrategies: currentStrategy?.assetStrategies || {},
      };

      for (const asset of config.assets) {
        updatedStrategy.assetStrategies[asset] = {
          targetCR: config.targetCR ?? updatedStrategy.assetStrategies[asset]?.targetCR ?? 160,
          minCR: config.minCR ?? updatedStrategy.assetStrategies[asset]?.minCR ?? 140,
          maxCR: config.maxCR ?? updatedStrategy.assetStrategies[asset]?.maxCR ?? 180,
          enabled: config.enabled ?? updatedStrategy.assetStrategies[asset]?.enabled ?? true,
        };
      }

      await updateStrategyInEnv(walletAddress, updatedStrategy);

      logger.info('✅ Strategy updated successfully', {
        walletAddress: maskAddress(walletAddress),
        strategy: updatedStrategy
      });

      console.log(`✅ Strategy updated for wallet: ${maskAddress(walletAddress)}`);
      console.log(`   Overall Enabled: ${updatedStrategy.enabled}`);
      console.log(`   Updated Assets: ${config.assets.join(', ')}`);
      
      console.log('\n📊 Asset Strategies:');
      for (const [asset, strategy] of Object.entries(updatedStrategy.assetStrategies)) {
        const isUpdated = config.assets.includes(asset);
        console.log(`   ${asset} ${isUpdated ? '✨ (Updated)' : ''}:`);
        console.log(`     Enabled: ${strategy.enabled}`);
        console.log(`     Target CR: ${strategy.targetCR}%`);
        console.log(`     Min CR: ${strategy.minCR}%`);
        console.log(`     Max CR: ${strategy.maxCR}%`);
      }
      
      console.log('\n🤖 Bot will automatically manage:');
      const enabledAssets = Object.entries(updatedStrategy.assetStrategies)
        .filter(([_, strategy]) => strategy.enabled)
        .map(([asset, _]) => asset);
      
      if (enabledAssets.length > 0) {
        console.log(`   📊 Enabled Assets: ${enabledAssets.join(', ')}`);
        console.log(`   📈 DEPOSIT collateral when CR < minCR for each asset`);
        console.log(`   📉 WITHDRAW collateral when CR > maxCR for each asset`);
        console.log(`   🎯 Maintain targetCR for each asset`);
      } else {
        console.log('   ⚠️  No enabled assets found');
      }

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
      console.log(`   Overall Status: ${strategy.enabled ? '✅ Enabled' : '❌ Disabled'}`);
      
      if (Object.keys(strategy.assetStrategies).length === 0) {
        console.log('   ⚠️  No asset strategies configured');
        return;
      }

      console.log(`\n📋 Asset Strategies (${Object.keys(strategy.assetStrategies).length}):`);
      for (const [asset, assetStrategy] of Object.entries(strategy.assetStrategies)) {
        console.log(`   ${asset}:`);
        console.log(`     Status: ${assetStrategy.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`     Target CR: ${assetStrategy.targetCR}%`);
        console.log(`     Min CR: ${assetStrategy.minCR}% (triggers DEPOSIT)`);
        console.log(`     Max CR: ${assetStrategy.maxCR}% (triggers WITHDRAWAL)`);
      }
      
      if (!strategy.enabled) {
        console.log('\n⚠️  Overall strategy is disabled - bot will not manage any CDPs');
        return;
      }

      const cdps = await this.cdpManager.getUserCDPs(walletAddress);
      if (cdps.length > 0) {
        console.log(`\n📋 Current CDPs (${cdps.length}):`);
        
        const currentPrices = await this.cdpManager.getCurrentPrices();
        if (currentPrices) {
          cdps.forEach((cdp, index) => {
            try {
              const assetStrategy = strategy.assetStrategies[cdp.assetType];
              const isAssetManaged = assetStrategy && assetStrategy.enabled;
              
              const assetPriceData = currentPrices[cdp.assetType as keyof typeof currentPrices];
              const assetPrice = (typeof assetPriceData === 'bigint') ? assetPriceData : currentPrices.iUSD;
              const currentCR = this.cdpManager.calculateCurrentCR(
                cdp.collateralAmount,
                cdp.mintedAmount,
                assetPrice
              );
              
              console.log(`   CDP ${index + 1}:`);
              console.log(`     Asset: ${cdp.assetType} ${isAssetManaged ? '✅' : '❌ Not managed'}`);
              console.log(`     Collateral: ${(Number(cdp.collateralAmount) / 1_000_000).toFixed(6)} ADA`);
              console.log(`     Minted: ${(Number(cdp.mintedAmount) / 1_000_000).toFixed(6)} ${cdp.assetType}`);
              console.log(`     Current CR: ${currentCR.toFixed(2)}%`);
              
              if (!isAssetManaged) {
                console.log(`     ⚪ Bot will: NOT MANAGE (no strategy configured for ${cdp.assetType})`);
              } else if (currentCR > assetStrategy.maxCR) {
                console.log(`     🔴 Bot will: WITHDRAW collateral (CR ${currentCR.toFixed(2)}% > ${assetStrategy.maxCR}%)`);
              } else if (currentCR < assetStrategy.minCR) {
                console.log(`     🟡 Bot will: DEPOSIT collateral (CR ${currentCR.toFixed(2)}% < ${assetStrategy.minCR}%)`);
              } else {
                console.log(`     🟢 Bot will: NO ACTION (CR within ${assetStrategy.minCR}%-${assetStrategy.maxCR}% range)`);
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
   * Remove strategy for a wallet or specific assets
   */
  async removeStrategy(walletAddress: string, assets?: string[]): Promise<void> {
    try {
      const isManaged = await this.walletManager.isWalletManaged(walletAddress);
      if (!isManaged) {
        throw new Error(`Wallet ${maskAddress(walletAddress)} is not managed`);
      }

      if (assets && assets.length > 0) {
        const currentStrategy = loadStrategyFromEnv(walletAddress);
        if (!currentStrategy) {
          throw new Error('No strategy found to remove assets from');
        }

        for (const asset of assets) {
          delete currentStrategy.assetStrategies[asset];
        }

        await updateStrategyInEnv(walletAddress, currentStrategy);
        console.log(`✅ Asset strategies removed for: ${assets.join(', ')}`);
        console.log(`   Wallet: ${maskAddress(walletAddress)}`);
        
        const remainingAssets = Object.keys(currentStrategy.assetStrategies);
        if (remainingAssets.length > 0) {
          console.log(`   Remaining assets: ${remainingAssets.join(', ')}`);
        } else {
          console.log('   No asset strategies remaining');
        }
      } else {
        await removeStrategyFromEnv(walletAddress);
        console.log(`✅ Complete strategy removed for wallet: ${maskAddress(walletAddress)}`);
        console.log('🤖 Bot will no longer manage any CDPs for this wallet');
      }

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
          console.log('Usage: npm run strategy-cli update <wallet_address> --assets=<assets> [options]');
          console.log('Options:');
          console.log('  --assets=iUSD,iBTC      - Assets to configure (comma-separated, REQUIRED)');
          console.log('  --enabled=true|false    - Enable/disable strategy for specified assets');
          console.log('  --target-cr=160         - Target collateral ratio (%)');
          console.log('  --min-cr=140           - Minimum CR - bot deposits when below (%)');
          console.log('  --max-cr=180           - Maximum CR - bot withdraws when above (%)');
          console.log('');
          console.log('Examples:');
          console.log('  npm run strategy-cli update addr123... --assets=iBTC --target-cr=200 --min-cr=195 --max-cr=205');
          console.log('  npm run strategy-cli update addr123... --assets=iUSD --target-cr=160 --min-cr=150 --max-cr=170');
          console.log('  npm run strategy-cli update addr123... --assets=iUSD,iBTC --enabled=false');
          process.exit(1);
        }

        const updateWalletAddress = args[1];
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
            config.assets = arg.split('=')[1].split(',').map(asset => asset.trim());
          }
        }

        await cli.updateStrategy(updateWalletAddress, config);
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
            console.log('Usage: npm run strategy-cli remove <wallet_address> [assets...]');
            process.exit(1);
          }

          const removeWalletAddress = args[1];
          const removeAssets = args.slice(2);
          await cli.removeStrategy(removeWalletAddress, removeAssets);
        break;

      default:
        console.log('CDP Bot Strategy CLI');
        console.log('\nCommands:');
        console.log('  update <address> [options]  - Update strategy configuration');
        console.log('  get <address>               - Get strategy status and CDP analysis');
        console.log('  remove <address> [assets...] - Remove strategy configuration or specific assets');
        console.log('');
        console.log('Strategy Parameters:');
        console.log('  --target-cr=160      - Target CR% (where bot aims to maintain)');
        console.log('  --min-cr=140         - Min CR% (bot deposits when CR falls below)');
        console.log('  --max-cr=180         - Max CR% (bot withdraws when CR rises above)');
        console.log('  --assets=iUSD,iBTC   - Assets to manage (comma-separated)');
        console.log('  --enabled=true       - Enable/disable automated management');
        console.log('');
        console.log('Examples:');
        console.log('  # Set strategy for iBTC');
        console.log('  npm run strategy-cli update addr123... --assets=iBTC --target-cr=200 --min-cr=195 --max-cr=205');
        console.log('  # Set different strategy for iUSD');
        console.log('  npm run strategy-cli update addr123... --assets=iUSD --target-cr=160 --min-cr=150 --max-cr=170');
        console.log('  # Configure multiple assets with same parameters');
        console.log('  npm run strategy-cli update addr123... --assets=iETH,iSOL --target-cr=180 --min-cr=170 --max-cr=190');
        console.log('  # View current strategies');
        console.log('  npm run strategy-cli get addr123...');
        console.log('  # Remove specific asset strategies');
        console.log('  npm run strategy-cli remove addr123... iBTC iUSD');
        console.log('  # Remove all strategies');
        console.log('  npm run strategy-cli remove addr123...');
        console.log('');
        console.log('Per-Asset Strategy Management:');
        console.log('  🎯 Each asset can have different CR parameters');
        console.log('  📊 Available assets: iUSD, iBTC, iETH, iSOL');
        console.log('  ✨ --assets flag is REQUIRED for update command');
        console.log('  🔄 Existing strategies for other assets are preserved');
        console.log('  ⚪ CDPs for assets without strategies will not be managed');
        console.log('');
        console.log('How it works:');
        console.log('  🤖 Bot monitors each asset strategy independently');
        console.log('  📈 For each asset: CR < minCR → Bot deposits collateral to reach targetCR');
        console.log('  📉 For each asset: CR > maxCR → Bot withdraws collateral to reach targetCR');
        console.log('  ⚖️  For each asset: minCR ≤ CR ≤ maxCR → Bot takes no action');
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