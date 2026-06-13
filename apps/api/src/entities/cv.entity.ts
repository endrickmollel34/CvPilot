import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';

import type { UserEntity } from './user.entity';
import type { AnalysisEntity } from './analysis.entity';

export type ParseStatus = 'pending' | 'processing' | 'done' | 'failed';

@Entity('cvs')
export class CvEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'file_name', length: 255 })
  fileName!: string;

  @Column({ name: 'r2_object_key', length: 512 })
  r2ObjectKey!: string;

  @Column({ name: 'file_size_bytes', type: 'integer' })
  fileSizeBytes!: number;

  @Column({ name: 'mime_type', length: 100 })
  mimeType!: string;

  @Column({ name: 'parsed_content', type: 'text', nullable: true })
  parsedContent?: string;

  @Column({ name: 'parse_status', length: 20, default: 'pending' })
  parseStatus!: ParseStatus;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @ManyToOne('UserEntity', (u: UserEntity) => u.cvs)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @OneToMany('AnalysisEntity', (a: AnalysisEntity) => a.cv)
  analyses?: AnalysisEntity[];
}
