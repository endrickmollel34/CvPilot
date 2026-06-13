import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';

import type { UserEntity } from './user.entity';

@Entity('profiles')
export class ProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'full_name', length: 255, nullable: true })
  fullName?: string;

  @Column({ length: 255, nullable: true })
  university?: string;

  @Column({ name: 'graduation_yr', type: 'smallint', nullable: true })
  graduationYr?: number;

  @Column({ name: 'student_email', length: 320, nullable: true })
  studentEmail?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne('UserEntity', (u: UserEntity) => u.profile)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
