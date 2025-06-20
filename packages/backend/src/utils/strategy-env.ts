import { IUserStrategy } from '@cdp-bot/shared';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { maskAddress } from './common.js';

/**
 * Generate short address identifier for environment variables
 * @param walletAddress - Full wallet address
 * @returns Shortened alphanumeric identifier
 */
function getShortAddress(walletAddress: string): string {
  return walletAddress.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
}

/**
 * Get path to .env file
 * @returns Absolute path to .env file
 */
function getEnvPath(): string {
  return path.join(process.cwd(), '.env');
}

/**
 * Common helper to update wallet entries in environment file
 * @param walletAddress - Wallet address
 * @param seedPhraseEntry - Seed phrase environment entry
 * @param strategyEntry - Strategy environment entry
 */
function updateWalletInEnvFile(walletAddress: string, seedPhraseEntry: string, strategyEntry: string): void {
  const envPath = getEnvPath();
  
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const shortAddress = getShortAddress(walletAddress);

  if (!envContent.includes('# ===== USER WALLETS =====')) {
    envContent += '\n\n# ===== USER WALLETS =====\n';
  }

  envContent = envContent.replace(new RegExp(`# Wallet: ${maskAddress(walletAddress)}\n`, 'g'), '');
  envContent = envContent.replace(new RegExp(`WALLET_SEEDPHRASE_${shortAddress}=.*\n?`, 'g'), '');
  envContent = envContent.replace(new RegExp(`STRATEGY_${shortAddress}=.*\n?`, 'g'), '');

  envContent += `\n# Wallet: ${maskAddress(walletAddress)}\n`;
  envContent += `${seedPhraseEntry}\n`;
  envContent += `${strategyEntry}\n`;

  fs.writeFileSync(envPath, envContent);
}

/**
 * Load strategy configuration from environment variables
 * @param walletAddress - Wallet address to load strategy for
 * @returns Strategy configuration or null if not found
 */
export function loadStrategyFromEnv(walletAddress: string): IUserStrategy | null {
  try {
    const shortAddress = getShortAddress(walletAddress);
    const strategyEnvVar = process.env[`STRATEGY_${shortAddress}`];
    
    if (!strategyEnvVar) {
      return null;
    }

    const parsedStrategy = JSON.parse(strategyEnvVar);
    
    if (parsedStrategy.maxTransactionValue && typeof parsedStrategy.maxTransactionValue === 'string') {
      parsedStrategy.maxTransactionValue = BigInt(parsedStrategy.maxTransactionValue);
    }

    return parsedStrategy as IUserStrategy;

  } catch (error) {
    logger.error('Failed to load strategy from environment:', { 
      walletAddress: maskAddress(walletAddress), 
      error 
    });
    return null;
  }
}

/**
 * Update strategy configuration in environment file
 * @param walletAddress - Wallet address
 * @param strategy - Strategy configuration to save
 */
export async function updateStrategyInEnv(walletAddress: string, strategy: IUserStrategy): Promise<void> {
  try {
    const shortAddress = getShortAddress(walletAddress);
    
    const seedPhraseEntry = `WALLET_SEEDPHRASE_${shortAddress}=${process.env[`WALLET_SEEDPHRASE_${shortAddress}`]}`;
    const strategyEntry = `STRATEGY_${shortAddress}=${JSON.stringify(strategy)}`;

    updateWalletInEnvFile(walletAddress, seedPhraseEntry, strategyEntry);
    
    process.env[`STRATEGY_${shortAddress}`] = JSON.stringify(strategy);
    
    logger.debug('Strategy updated in environment file', {
      walletAddress: maskAddress(walletAddress),
      strategy: {
        enabled: strategy.enabled,
        targetCR: strategy.targetCR
      }
    });

  } catch (error) {
    logger.error('Failed to update strategy in environment file:', error);
    throw error;
  }
}

/**
 * Add complete wallet configuration (seed phrase + strategy) to environment file
 * @param walletAddress - Wallet address
 * @param seedPhrase - Wallet seed phrase (should be encrypted/secured)
 * @param strategy - Strategy configuration
 */
export async function addWalletToEnv(walletAddress: string, seedPhrase: string, strategy: IUserStrategy): Promise<void> {
  try {
    const shortAddress = getShortAddress(walletAddress);
    
    const seedPhraseEntry = `WALLET_SEEDPHRASE_${shortAddress}=${seedPhrase}`;
    const strategyEntry = `STRATEGY_${shortAddress}=${JSON.stringify(strategy)}`;

    updateWalletInEnvFile(walletAddress, seedPhraseEntry, strategyEntry);
    
    logger.info('Wallet added to environment file', {
      walletAddress: maskAddress(walletAddress)
    });

  } catch (error) {
    logger.error('Failed to add wallet to environment file:', error);
    throw error;
  }
}

/**
 * Remove wallet configuration from environment file
 * @param walletAddress - Wallet address to remove
 */
export async function removeStrategyFromEnv(walletAddress: string): Promise<void> {
  try {
    const envPath = getEnvPath();
    
    if (!fs.existsSync(envPath)) {
      return;
    }

    let envContent = fs.readFileSync(envPath, 'utf8');
    const shortAddress = getShortAddress(walletAddress);

    envContent = envContent.replace(new RegExp(`# Wallet: ${maskAddress(walletAddress)}\n`, 'g'), '');
    envContent = envContent.replace(new RegExp(`WALLET_SEEDPHRASE_${shortAddress}=.*\n?`, 'g'), '');
    envContent = envContent.replace(new RegExp(`STRATEGY_${shortAddress}=.*\n?`, 'g'), '');

    envContent = envContent.replace(/\n\n\n+/g, '\n\n');

    fs.writeFileSync(envPath, envContent);
    
    logger.debug('Wallet removed from environment file', {
      walletAddress: maskAddress(walletAddress)
    });

  } catch (error) {
    logger.error('Failed to remove wallet from environment file:', error);
    throw error;
  }
}