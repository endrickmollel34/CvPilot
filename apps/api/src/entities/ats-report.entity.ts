import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';

import type { AnalysisEntity } from './analysis.entity';
import type { AtsKeyword } from '@cvpilot/shared';

@Entity('ats_reports')
export class AtsReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'analysis_id' })
  analysisId!: string;

  @Column({ name: 'keyword_hits', type: 'jsonb', nullable: true })
  keywordHits?: AtsKeyword[];

  @Column({ name: 'missing_keywords', type: 'jsonb', nullable: true })
  missingKeywords?: string[];

  @Column({ name: 'format_warnings', type: 'jsonb', nullable: true })
  formatWarnings?: Array<{ type: string; description: string }>;

  @Column({ name: 'ats_score', type: 'smallint', nullable: true })
  atsScore?: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToOne('AnalysisEntity', (a: AnalysisEntity) => a.atsReport)
  @JoinColumn({ name: 'analysis_id' })
  analysis?: AnalysisEntity;
}
