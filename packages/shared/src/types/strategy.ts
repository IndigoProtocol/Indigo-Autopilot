export interface IAssetStrategy {
  targetCR: number;
  minCR: number;
  maxCR: number;
  enabled: boolean;
}

export interface IUserStrategy {
  walletAddress: string;
  enabled: boolean;
  assetStrategies: {
    [assetName: string]: IAssetStrategy;
  };
}

export interface IStrategyAction {
  type: 'WITHDRAW_COLLATERAL' | 'DEPOSIT_COLLATERAL' | 'NO_ACTION';
  cdpId: string;
  currentCR: number;
  targetCR: number;
  adjustmentAmount?: bigint;
  reason?: string;
}

export interface IAssetPrices {
  iUSD: bigint;
  iBTC: bigint;
  iETH: bigint;
  iSOL: bigint;
  timestamp?: Date;
}

export interface IWalletData {
  address: string;
  seedphrase: string;
}

export interface ICalculationResult {
  requiredCollateral: bigint;
  currentCollateral: bigint;
  adjustmentAmount: bigint;
  newCR: number;
} 