import logger from './logger.js';
import { maskAddress } from './common.js';

/**
 * Standardized error handler for service methods
 * @param error - The error to handle
 * @param context - Context information for logging
 * @param rethrow - Whether to rethrow the error (default: true)
 */
export function handleServiceError(
  error: unknown, 
  context: { 
    service: string; 
    method: string; 
    walletAddress?: string;
    [key: string]: any;
  },
  rethrow: boolean = true
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const logContext = {
    ...context,
    error: errorMessage
  };

  if (logContext.walletAddress) {
    logContext.walletAddress = maskAddress(logContext.walletAddress);
  }

  logger.error(`${context.service}.${context.method} failed:`, logContext);

  if (rethrow) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(errorMessage);
  }
}