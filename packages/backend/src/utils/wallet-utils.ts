import logger from './logger.js';
import { maskAddress } from './common.js';
import * as crypto from 'crypto';

/**
 * Get encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }
  
  return crypto.scryptSync(key, 'cdp-management-salt', 32);
}

/**
 * Encrypt seed phrase using AES-256-CBC
 */
export function encryptSeedphrase(seedphrase: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(seedphrase, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;

  } catch (error) {
    logger.error('❌ Encryption failed:', error);
    throw new Error('Failed to encrypt seed phrase');
  }
}

/**
 * Decrypt seed phrase using AES-256-CBC
 */
export function decryptSeedphrase(encryptedSeedphrase: string): string {
  try {
    if (!encryptedSeedphrase.includes(':') && encryptedSeedphrase.includes(' ')) {
      return encryptedSeedphrase;
    }

    const key = getEncryptionKey();
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
    logger.error('❌ Decryption failed:', error);
    throw new Error('Failed to decrypt seed phrase');
  }
}

/**
 * Store seed phrase for a wallet address in environment variables
 */
export async function storeSeedphrase(walletAddress: string, seedphrase: string): Promise<void> {
  const words = seedphrase.trim().split(' ');
  if (words.length !== 24) {
    throw new Error('Invalid seed phrase: must be 24 words');
  }

  const encryptedSeedphrase = encryptSeedphrase(seedphrase);
  
  const envKey = `WALLET_SEEDPHRASE_${walletAddress}`;
  process.env[envKey] = encryptedSeedphrase;
  
  logger.info('Seed phrase stored successfully', { 
    walletAddress: maskAddress(walletAddress),
    envKey 
  });
}

/**
 * Retrieve seed phrase for a wallet address from environment variables
 */
export async function getSeedphrase(walletAddress: string): Promise<string | null> {
  try {
    const seedPhraseKey = `WALLET_SEEDPHRASE_${walletAddress}`;
    const encryptedSeedphrase = process.env[seedPhraseKey];

    if (!encryptedSeedphrase) {
      logger.error('❌ No seed phrase found in environment', {
        walletAddress: maskAddress(walletAddress),
        envKey: seedPhraseKey.substring(0, 30) + '...',
        allEnvKeys: Object.keys(process.env).filter(k => k.startsWith('WALLET_')).map(k => k.substring(0, 30) + '...')
      });
      return null;
    }

    return decryptSeedphrase(encryptedSeedphrase);

  } catch (error) {
    logger.error('❌ Failed to retrieve seed phrase:', { 
      walletAddress: maskAddress(walletAddress), 
      error 
    });
    return null;
  }
}

/**
 * Remove seed phrase from storage
 */
export async function removeSeedphrase(walletAddress: string): Promise<boolean> {
  try {
    const envKey = `WALLET_SEEDPHRASE_${walletAddress}`;
    
    delete process.env[envKey];
    
    logger.info('Seed phrase removed successfully', { 
      walletAddress: maskAddress(walletAddress) 
    });
    
    return true;

  } catch (error) {
    logger.error('❌ Failed to remove seed phrase:', { 
      walletAddress: maskAddress(walletAddress), 
      error 
    });
    return false;
  }
}

/**
 * Load wallet data from environment variables
 */
export async function loadWalletFromEnv(walletAddress: string): Promise<{ address: string; seedphrase: string } | undefined> {
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
    logger.error('❌ Failed to load wallet from environment:', {
      walletAddress: maskAddress(walletAddress),
      error
    });
    return undefined;
  }
} 