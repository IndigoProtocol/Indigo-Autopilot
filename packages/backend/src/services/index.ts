export { CDPManagerService } from './cdp-manager.service.js';
export { WalletManagerService } from './wallet-manager.service.js';
export { StrategyEngineService } from './strategy-engine.service.js';
export { BalanceService } from './balance.service.js';
export { BaseService } from './base-service.js';

export { serviceRegistry } from './service-registry.js';

import { serviceRegistry } from './service-registry.js';
import { CDPManagerService } from './cdp-manager.service.js';
import { WalletManagerService } from './wallet-manager.service.js';
import { StrategyEngineService } from './strategy-engine.service.js';
import { BalanceService } from './balance.service.js';
import { BaseService } from './base-service.js';

serviceRegistry.register('CDPManagerService', CDPManagerService);
serviceRegistry.register('WalletManagerService', WalletManagerService);
serviceRegistry.register('StrategyEngineService', StrategyEngineService);
serviceRegistry.register('BalanceService', BalanceService);

/**
 * Initialize all services
 */
export async function initializeAllServices(): Promise<void> {
  await serviceRegistry.initializeAllServices();
}

/**
 * Get a service instance (singleton)
 */
export function getService<T extends BaseService>(serviceName: string): T {
  return serviceRegistry.get<T>(serviceName);
} 