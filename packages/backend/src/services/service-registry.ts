/**
 * Service Registry - Manages singleton instances and initialization order
 */
import logger from '../utils/logger.js';
import { BaseService } from './base-service.js';

type ServiceConstructor = new () => BaseService;

class ServiceRegistry {
  private services = new Map<string, BaseService>();
  private serviceConstructors = new Map<string, ServiceConstructor>();
  private initializingServices = new Set<string>();
  private initializedServices = new Set<string>();

  /**
   * Register a service constructor
   */
  register(name: string, constructor: ServiceConstructor): void {
    this.serviceConstructors.set(name, constructor);
    logger.debug(`Registered service: ${name}`);
  }

  /**
   * Get or create a service instance
   */
  get<T extends BaseService>(name: string): T {
    if (this.services.has(name)) {
      return this.services.get(name) as T;
    }

    const constructor = this.serviceConstructors.get(name);
    if (!constructor) {
      throw new Error(`Service ${name} not registered`);
    }

    const instance = new constructor() as T;
    this.services.set(name, instance);
    
    return instance;
  }

  /**
   * Initialize a specific service
   */
  async initializeService(name: string): Promise<void> {
    if (this.initializedServices.has(name)) {
      return;
    }

    if (this.initializingServices.has(name)) {
      logger.warn(`Circular dependency detected for service: ${name}`);
      return;
    }

    this.initializingServices.add(name);

    try {
      const service = this.get(name);
      await service.initialize();
      this.initializedServices.add(name);
      logger.debug(`Initialized service: ${name}`);
    } catch (error) {
      logger.error(`Failed to initialize service ${name}:`, error);
      throw error;
    } finally {
      this.initializingServices.delete(name);
    }
  }

  /**
   * Initialize all registered services
   */
  async initializeAllServices(): Promise<void> {
    const serviceNames = [
      'WalletManagerService',
      'CDPManagerService',
      'BalanceService', 
      'StrategyEngineService'
    ];

    for (const serviceName of serviceNames) {
      if (this.serviceConstructors.has(serviceName)) {
        await this.initializeService(serviceName);
      }
    }
  }
}

export const serviceRegistry = new ServiceRegistry(); 