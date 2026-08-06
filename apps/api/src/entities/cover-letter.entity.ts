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
import type { CvEntity } from './cv.entity';
import type { AnalysisEntity } from './analysis.entity';

export type CoverLetterStatus = 'queued' | 'processing' | 'generated' | 'failed' | 'downloaded';

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

  @Column({ length: 30, nullable: true })
  tone?: string;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt?: Date;

  @Column({ length: 20, default: 'queued' })
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

  @ManyToOne('CvEntity')
  @JoinColumn({ name: 'cv_id' })
  cv?: CvEntity;

  @ManyToOne('AnalysisEntity')
  @JoinColumn({ name: 'analysis_id' })
  analysis?: AnalysisEntity;
}
