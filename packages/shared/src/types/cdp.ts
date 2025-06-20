export interface ICDP {
  cdpId: string;
  walletAddress: string;
  collateralAmount: bigint;
  mintedAmount: bigint;
  assetType: string;
  currentCR: number;
  outputHash: string;
  outputIndex: number;
  slot: number;
  version: string;
  lastUpdated: Date;
}