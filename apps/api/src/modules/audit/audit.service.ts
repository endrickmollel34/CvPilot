import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, type EntityManager } from 'typeorm';

import { AuditLogEntity } from '../../entities/audit-log.entity';

interface AuditLogParams {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  // Fire-and-forget — callers do not await this. Appropriate only for
  // audit trail entries where losing the write is acceptable (nothing
  // downstream depends on it existing). For a record that something else
  // — e.g. quota accounting — actually depends on, use logTransactional()
  // instead so a write failure is never silently swallowed.
  log(params: AuditLogParams): void {
    this.auditRepo.save(this.auditRepo.create(params)).catch(() => {
      // Audit log failure must never crash the calling request
    });
  }

  // Reliability fix (quota-accounting write side): participates in the
  // caller's own transaction via `manager` rather than this service's own
  // injected repo, and is awaited — so a failure here propagates and rolls
  // back whatever else the caller wrote in the same transaction (e.g. the
  // generated content/status update), rather than being silently swallowed
  // the way log() deliberately is. Used by AnalysisService/CoverLetterService/
  // TailoringService's success paths so "the result was persisted" and "the
  // usage event was recorded" can never diverge: either both happen or
  // neither does. See each caller's own transaction for the exact scope.
  async logTransactional(manager: EntityManager, params: AuditLogParams): Promise<void> {
    const repo = manager.getRepository(AuditLogEntity);
    await repo.save(repo.create(params));
  }

  // Quota-accounting read side (see usage-actions.ts for the full
  // rationale). DISTINCT entity_id means a resource that logs this action
  // more than once for the same row — e.g. Cover Letter's regenerate(),
  // which re-triggers the same success path on the same coverLetterId —
  // still only counts once, matching the old per-row counting semantics.
  // audit_logs is append-only, so this count can never be reduced by a
  // caller deleting the content row the log entry refers to.
  async countDistinctEntitiesSince(params: {
    userId: string;
    action: string;
    since: Date;
  }): Promise<number> {
    const raw = await this.auditRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.entity_id)', 'count')
      .where('log.user_id = :userId', { userId: params.userId })
      .andWhere('log.action = :action', { action: params.action })
      .andWhere('log.created_at >= :since', { since: params.since })
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }
}
