import * as IndigoSDK from '@indigo-labs/indigo-sdk';
import logger from '../utils/logger';

class IndigoParamsConfig {
  private systemParams: IndigoSDK.SystemParams | null = null;
  private initialized = false;

  /**
   * Initialize and load system parameters
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.systemParams) {
      return;
    }

    try {
      const paramsUrl = process.env.INDIGO_SYSTEM_PARAMS_URL;
      if (paramsUrl) {
        this.systemParams = await IndigoSDK.loadSystemParamsFromUrl(paramsUrl);
        this.initialized = true;
        return;
      }

      const paramsFile = process.env.INDIGO_SYSTEM_PARAMS_FILE;
      if (paramsFile) {
        this.systemParams = IndigoSDK.loadSystemParamsFromFile(paramsFile);
        this.initialized = true;
        return;
      }

      // Default parameters for mainnet/testnet
      const network = process.env.NETWORK || 'mainnet';
      const defaultUrl = network === 'mainnet' 
        ? 'https://config.indigoprotocol.io/mainnet/mainnet-system-params-v21.json'
        : 'https://config.indigoprotocol.io/testnet/testnet-system-params-v21.json';

      this.systemParams = await IndigoSDK.loadSystemParamsFromUrl(defaultUrl);
      this.initialized = true;

    } catch (error) {
      logger.error('Failed to load Indigo system parameters:', error);
      throw new Error(`Failed to load Indigo system parameters: ${error}`);
    }
  }

  /**
   * Get system parameters (initialize if not already done)
   */
  async getSystemParams(): Promise<IndigoSDK.SystemParams> {
    if (!this.initialized || !this.systemParams) {
      await this.initialize();
    }

    if (!this.systemParams) {
      throw new Error('System parameters not loaded');
    }

    return this.systemParams;
  }
}

export default new IndigoParamsConfig();