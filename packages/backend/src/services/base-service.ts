import logger from '../utils/logger';
import { handleServiceError } from '../utils/error-handler';

/**
 * Base service class with common initialization patterns and error handling
 */
export abstract class BaseService {
  protected initialized: boolean = false;
  
  constructor(protected serviceName: string) {}

  /**
   * Initialize the service - must be implemented by subclasses
   */
  abstract initialize(): Promise<void>;

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Protected async wrapper with error handling and auto-initialization
   * NOTE: This should NOT be used within the initialize() method to avoid circular calls
   */
  protected async executeAsync<T>(
    method: string,
    operation: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<T> {
    try {
      if (method !== 'initialize') {
        await this.ensureInitialized();
      }
      return await operation();
    } catch (error) {
      handleServiceError(error, {
        service: this.serviceName,
        method,
        ...context
      });
      throw error;
    }
  }

  /**
   * Protected async wrapper for initialize method only
   */
  protected async executeAsyncInitialize<T>(
    operation: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      handleServiceError(error, {
        service: this.serviceName,
        method: 'initialize',
        ...context
      });
      throw error;
    }
  }

  /**
   * Log service initialization
   */
  protected logInitialization(success: boolean, details?: Record<string, any>): void {
    if (success) {
      this.initialized = true;
    } else {
      logger.error(`❌ ${this.serviceName} initialization failed`, details);
    }
  }
} 