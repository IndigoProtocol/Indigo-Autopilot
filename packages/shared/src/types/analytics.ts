export interface IPriceData {
  asset: string;
  price: bigint;
  slot: number;
  expiration?: Date;
} 