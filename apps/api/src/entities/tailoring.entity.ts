import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

import type { TailoringSuggestion, TailoringDecision, TailoringStatus } from '@cvpilot/shared';

@Entity('tailorings')
export class TailoringEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'master_cv_id' })
  masterCvId!: string;

  @Column({ name: 'tailored_cv_id', nullable: true })
  tailoredCvId?: string;

  @Column({ name: 'job_title', length: 255, nullable: true })
  jobTitle?: string;

  @Column({ name: 'company_name', length: 255, nullable: true })
  companyName?: string;

  @Column({ name: 'job_description', type: 'text' })
  jobDescription!: string;

  @Column({ name: 'suggestions', type: 'jsonb', nullable: true })
  suggestions?: TailoringSuggestion[];

  @Column({ name: 'decisions', type: 'jsonb', nullable: true })
  decisions?: TailoringDecision[];

  @Column({ name: 'model_used', length: 100, nullable: true })
  modelUsed?: string;

  @Column({ name: 'tokens_used', type: 'integer', nullable: true })
  tokensUsed?: number;

  @Column({ name: 'status', length: 20, default: 'pending' })
  status!: TailoringStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;
}
