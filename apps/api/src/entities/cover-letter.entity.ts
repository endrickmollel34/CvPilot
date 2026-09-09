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

  // V2 — persisted (rather than submit-time-only) so the workspace can
  // redisplay/edit it later and so "Regenerate" has something to send back
  // to the AI service without the caller re-supplying it. Nullable: every
  // pre-V2 row has none, and that must remain a valid, renderable state
  // (regenerate just asks the user to fill it in first).
  @Column({ name: 'job_description', type: 'text', nullable: true })
  jobDescription?: string;

  @Column({ name: 'recipient_name', length: 255, nullable: true })
  recipientName?: string;

  @Column({ name: 'recipient_title', length: 255, nullable: true })
  recipientTitle?: string;

  // Free-text, deliberately not split into street/city/postcode fields —
  // an MVP letterhead only ever needs to print it back out verbatim.
  @Column({ name: 'company_address', type: 'text', nullable: true })
  companyAddress?: string;

  // V2.1 — the candidate's own postal address for the sender block of a
  // proper two-sided business letter. Always optional; never inferred
  // from the linked CV (see 1750800000000-CoverLetterSenderAddress's doc
  // comment for why). Typed `| null` (unlike its siblings above) because
  // the editor needs to express "explicitly cleared" as distinct from
  // "field omitted from this PATCH" — see update-cover-letter.dto.ts.
  @Column({ name: 'sender_address', type: 'text', nullable: true })
  senderAddress?: string | null;

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
