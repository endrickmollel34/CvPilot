import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';

import type { ProfileEntity } from './profile.entity';
import type { CvEntity } from './cv.entity';
import type { SubscriptionEntity } from './subscription.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'clerk_id', unique: true })
  clerkId!: string;

  @Column({ unique: true, length: 320 })
  email!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @OneToOne('ProfileEntity', (p: ProfileEntity) => p.user)
  profile?: ProfileEntity;

  @OneToMany('CvEntity', (cv: CvEntity) => cv.user)
  cvs?: CvEntity[];

  @OneToOne('SubscriptionEntity', (s: SubscriptionEntity) => s.user)
  subscription?: SubscriptionEntity;
}
