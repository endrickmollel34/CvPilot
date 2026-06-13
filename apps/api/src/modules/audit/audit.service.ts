import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';

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

  // Fire-and-forget — callers do not await this
  log(params: AuditLogParams): void {
    this.auditRepo.save(this.auditRepo.create(params)).catch(() => {
      // Audit log failure must never crash the calling request
    });
  }
}
