import logger from './logger.js';

/**
 * Mask wallet address for logging security
 * @param address - The wallet address to mask
 * @returns Masked address with first 6 and last 4 characters visible
 */
export function maskAddress(address: string): string {
  if (address.length <= 10) {
    return '*'.repeat(address.length);
  }
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/**
 * Get asset price from prices object
 * @param assetType - The asset type (iUSD, iBTC, iETH, iSOL)
 * @param prices - The prices object containing asset prices
 * @returns The price as BigInt or 0 if asset not found
 */
export function getAssetPrice(assetType: string, prices: any): bigint {
  switch (assetType) {
    case 'iUSD':
      return prices.iUSD;
    case 'iBTC':
      return prices.iBTC;
    case 'iETH':
      return prices.iETH;
    case 'iSOL':
      return prices.iSOL;
    default:
      logger.warn('Unknown asset type:', { assetType });
      return BigInt(0);
  }
}

/**
 * Create delay for rate limiting
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standardized error response for API routes
 * @param error - The error object
 * @param defaultMessage - Default error message if error has no message
 * @returns Standardized error object
 */
export function createErrorResponse(error: unknown, defaultMessage: string = 'An error occurred') {
  return {
    success: false,
    message: defaultMessage,
    error: error instanceof Error ? error.message : String(error)
  };
}

/**
 * Standardized success response for API routes
 * @param data - The response data
 * @param message - Success message
 * @returns Standardized success object
 */
export function createSuccessResponse<T>(data: T, message: string = 'Success') {
  return {
    success: true,
    message,
    data
  };
}

/**
 * Format price from lovelace to ADA with proper comma formatting
 * @param lovelacePrice - Price in lovelace (bigint)
 * @returns Formatted price string with ADA symbol
 */
export function formatPriceInADA(lovelacePrice: bigint): string {
  const adaPrice = Number(lovelacePrice) / 1_000_000;
  return `₳${adaPrice.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 6 
  })}`;
}

/**
 * Format prices object for logging
 * @param prices - IAssetPrices object with bigint values
 * @returns Object with formatted price strings
 */
export function formatPricesForLogging(prices: any): Record<string, string> {
  return {
    iUSD: formatPriceInADA(BigInt(prices.iUSD)),
    iBTC: formatPriceInADA(BigInt(prices.iBTC)),
    iETH: formatPriceInADA(BigInt(prices.iETH)),
    iSOL: formatPriceInADA(BigInt(prices.iSOL)),
  };
} 