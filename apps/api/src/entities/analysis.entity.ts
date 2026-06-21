import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';

import type { UserEntity } from './user.entity';
import type { CvEntity } from './cv.entity';
import type { AtsReportEntity } from './ats-report.entity';
import type { Suggestion } from '@cvpilot/shared';

export type AnalysisStatus = 'pending' | 'processing' | 'done' | 'failed';

@Entity('analyses')
export class AnalysisEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'cv_id' })
  cvId!: string;

  @Column({ name: 'job_title', length: 255, nullable: true })
  jobTitle?: string;

  @Column({ name: 'company_name', length: 255, nullable: true })
  companyName?: string;

  @Column({ name: 'job_description', type: 'text' })
  jobDescription!: string;

  @Column({ name: 'match_score', type: 'smallint', nullable: true })
  matchScore?: number;

  @Column({ type: 'jsonb', nullable: true })
  suggestions?: Suggestion[];

  @Column({ name: 'model_used', length: 100, nullable: true })
  modelUsed?: string;

  @Column({ name: 'tokens_used', type: 'integer', nullable: true })
  tokensUsed?: number;

  @Column({ length: 20, default: 'pending' })
  status!: AnalysisStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @ManyToOne('UserEntity')
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne('CvEntity', (cv: CvEntity) => cv.analyses)
  @JoinColumn({ name: 'cv_id' })
  cv?: CvEntity;

  @OneToOne('AtsReportEntity', (r: AtsReportEntity) => r.analysis)
  atsReport?: AtsReportEntity;
}
