import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('prices')
@Index(['asset'])
@Index(['slot'])
export class Price {
  @PrimaryColumn({
    type: 'varchar',
    length: 767,
  })
  hash!: string;

  @Column({
    type: 'int',
    unsigned: true,
    nullable: false,
  })
  slot!: number;

  @Column({
    name: 'output_hash',
    type: 'varchar',
    length: 191,
    nullable: false,
  })
  outputHash!: string;

  @Column({
    name: 'output_index',
    type: 'int',
    unsigned: true,
    nullable: false,
  })
  outputIndex!: number;

  @Column({
    type: 'varchar',
    length: 191,
    nullable: false,
  })
  asset!: string;

  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: false,
  })
  price!: string;

  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: false,
  })
  expiration!: string;

  @Column({
    type: 'varchar',
    length: 191,
    nullable: false,
    default: '',
  })
  address!: string;

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

  get priceAsBigInt(): bigint {
    return BigInt(this.price);
  }

  set priceAsBigInt(value: bigint) {
    this.price = value.toString();
  }
} 