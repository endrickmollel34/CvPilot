import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import type {
  PaymentProviderType,
  PaymentMethodType,
  Currency,
  PaymentStatus,
} from '@cvpilot/shared';
import type { UserEntity } from './user.entity';

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'provider', length: 30 })
  provider!: PaymentProviderType;

  @Column({ name: 'provider_payment_id', unique: true })
  providerPaymentId!: string;

  @Column({ name: 'provider_transaction_reference', length: 255, nullable: true })
  providerTransactionReference?: string;

  @Column({ name: 'payment_method', length: 30, nullable: true })
  paymentMethod?: PaymentMethodType;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ length: 3, default: 'GBP' })
  currency!: Currency;

  @Column({ length: 30 })
  status!: PaymentStatus;

  @Column({ name: 'provider_metadata', type: 'jsonb', nullable: true })
  providerMetadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne('UserEntity')
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
