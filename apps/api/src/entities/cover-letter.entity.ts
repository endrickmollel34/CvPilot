import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import type { UserEntity } from './user.entity';

export type CoverLetterStatus = 'draft' | 'generated' | 'downloaded';

@Entity('cover_letters')
export class CoverLetterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'analysis_id', nullable: true })
  analysisId?: string;

  @Column({ name: 'cv_id' })
  cvId!: string;

  @Column({ name: 'job_title', length: 255, nullable: true })
  jobTitle?: string;

  @Column({ name: 'company_name', length: 255, nullable: true })
  companyName?: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'r2_object_key', length: 512, nullable: true })
  r2ObjectKey?: string;

  @Column({ name: 'model_used', length: 100, nullable: true })
  modelUsed?: string;

  @Column({ name: 'tokens_used', type: 'integer', nullable: true })
  tokensUsed?: number;

  @Column({ length: 20, default: 'draft' })
  status!: CoverLetterStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @ManyToOne('UserEntity')
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
