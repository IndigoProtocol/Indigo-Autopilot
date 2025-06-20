import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('collateralized_debt_positions')
@Index(['owner'])
@Index(['outputHash', 'outputIndex'])
@Index(['asset'])
export class CollateralizedDebtPosition {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({
    type: 'int',
    nullable: false,
  })
  slot!: number;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  version!: string;

  @Column({
    name: 'output_hash',
    type: 'varchar',
    length: 64,
    nullable: false,
  })
  outputHash!: string;

  @Column({
    name: 'output_index',
    type: 'int',
    nullable: false,
  })
  outputIndex!: number;

  @Column({
    type: 'varchar',
    length: 103, // Cardano address length
    nullable: false,
  })
  owner!: string;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: false,
  })
  asset!: string;

  @Column({
    name: 'mintedAmount',
    type: 'bigint',
    nullable: false,
  })
  mintedAmount!: string;

  @Column({
    name: 'collateralAmount',
    type: 'bigint',
    nullable: false,
  })
  collateralAmount!: string;

  @Column({
    type: 'boolean',
    default: false,
    nullable: true,
  })
  consumed!: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
  })
  updatedAt!: Date;

  get mintedAmountAsBigInt(): bigint {
    return BigInt(this.mintedAmount);
  }

  set mintedAmountAsBigInt(value: bigint) {
    this.mintedAmount = value.toString();
  }

  get collateralAmountAsBigInt(): bigint {
    return BigInt(this.collateralAmount);
  }

  set collateralAmountAsBigInt(value: bigint) {
    this.collateralAmount = value.toString();
  }

  get cdpId(): string {
    return `${this.outputHash}#${this.outputIndex}`;
  }
} 