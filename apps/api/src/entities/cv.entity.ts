import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';

import type { CvContent, CvSource } from '@cvpilot/shared';
import type { UserEntity } from './user.entity';
import type { AnalysisEntity } from './analysis.entity';

export type ParseStatus = 'pending' | 'processing' | 'done' | 'failed';

@Entity('cvs')
export class CvEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'title', length: 255, nullable: true })
  title?: string;

  @Column({ name: 'source', length: 20, default: 'upload' })
  source!: CvSource;

  @Column({ name: 'content', type: 'jsonb', nullable: true })
  content?: CvContent;

  @Column({ name: 'file_name', length: 255, nullable: true })
  fileName?: string;

  @Column({ name: 'r2_object_key', length: 512, nullable: true })
  r2ObjectKey?: string;

  @Column({ name: 'file_size_bytes', type: 'integer', nullable: true })
  fileSizeBytes?: number;

  @Column({ name: 'mime_type', length: 100, nullable: true })
  mimeType?: string;

  @Column({ name: 'parsed_content', type: 'text', nullable: true })
  parsedContent?: string;

  @Column({ name: 'parse_status', length: 20, default: 'pending' })
  parseStatus!: ParseStatus;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @ManyToOne('UserEntity', (u: UserEntity) => u.cvs)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @OneToMany('AnalysisEntity', (a: AnalysisEntity) => a.cv)
  analyses?: AnalysisEntity[];
}
