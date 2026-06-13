import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';

import type { Plan, SubscriptionStatus } from '@cvpilot/shared';
import type { UserEntity } from './user.entity';

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', unique: true })
  userId!: string;

  @Column({ name: 'stripe_customer_id', unique: true })
  stripeCustomerId!: string;

  @Column({ name: 'stripe_subscription_id', unique: true, nullable: true })
  stripeSubscriptionId?: string;

  @Column({ length: 20, default: 'free' })
  plan!: Plan;

  @Column({ length: 30, default: 'active' })
  status!: SubscriptionStatus;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart?: Date;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd?: Date;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne('UserEntity', (u: UserEntity) => u.subscription)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
