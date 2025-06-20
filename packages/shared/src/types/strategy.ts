// Strategy type definitions
export interface IUserStrategy {
  walletAddress: string;
  enabled: boolean;
  minCR: number;
  maxCR: number;
  targetCR: number;
  enabledAssets?: string[]; // Assets this strategy applies to (e.g., ['iUSD', 'iBTC'])
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