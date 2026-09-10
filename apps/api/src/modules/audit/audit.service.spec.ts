import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from './audit.service';
import { AuditLogEntity } from '../../entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };
  const mockAuditRepo = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLogEntity), useValue: mockAuditRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  // ─── log() ──────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('creates and saves a row with the given params', () => {
      mockAuditRepo.create.mockReturnValue({ userId: 'user-1', action: 'analysis.generated' });
      mockAuditRepo.save.mockResolvedValue(undefined);

      service.log({ userId: 'user-1', action: 'analysis.generated', entityType: 'analysis' });

      expect(mockAuditRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'analysis.generated',
        entityType: 'analysis',
      });
      expect(mockAuditRepo.save).toHaveBeenCalled();
    });

    it('does not throw when the save rejects — a fire-and-forget failure must never crash the caller', () => {
      mockAuditRepo.create.mockReturnValue({});
      mockAuditRepo.save.mockRejectedValue(new Error('DB unavailable'));

      expect(() => service.log({ userId: 'user-1', action: 'analysis.generated' })).not.toThrow();
    });
  });

  // ─── logTransactional() ─────────────────────────────────────────────────────
  // Reliability fix's write side: unlike log(), this is awaited and writes
  // through the CALLER's own EntityManager (never this service's own
  // injected repo) — so it genuinely participates in whatever transaction
  // the caller opened, and a failure here propagates to roll that
  // transaction back, rather than being silently swallowed.

  describe('logTransactional()', () => {
    it('writes through the given manager, not the injected repo', async () => {
      const mockTxRepo = { create: jest.fn(), save: jest.fn() };
      const mockManager = { getRepository: jest.fn(() => mockTxRepo) };
      mockTxRepo.create.mockReturnValue({ userId: 'user-1', action: 'analysis.generated' });
      mockTxRepo.save.mockResolvedValue(undefined);

      await service.logTransactional(mockManager as never, {
        userId: 'user-1',
        action: 'analysis.generated',
        entityType: 'analysis',
        entityId: 'an-1',
      });

      expect(mockManager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
      expect(mockTxRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'analysis.generated',
        entityType: 'analysis',
        entityId: 'an-1',
      });
      expect(mockTxRepo.save).toHaveBeenCalled();
      // The service's own directly-injected repo is never touched.
      expect(mockAuditRepo.create).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
    });

    it('propagates a write failure to the caller instead of swallowing it', async () => {
      const mockTxRepo = { create: jest.fn(), save: jest.fn() };
      const mockManager = { getRepository: jest.fn(() => mockTxRepo) };
      mockTxRepo.create.mockReturnValue({});
      mockTxRepo.save.mockRejectedValue(new Error('DB unavailable'));

      await expect(
        service.logTransactional(mockManager as never, {
          userId: 'user-1',
          action: 'analysis.generated',
        }),
      ).rejects.toThrow('DB unavailable');
    });
  });

  // ─── countDistinctEntitiesSince() ──────────────────────────────────────────
  // The quota-refund fix's read side (see usage-actions.ts) — must count
  // distinct entity_id values scoped to exactly userId + action + since, so
  // BillingService/TailoringService get a durable count immune to the
  // referenced content row later being hard-deleted.

  describe('countDistinctEntitiesSince()', () => {
    it('scopes the query by userId, action, and the since boundary', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '3' });
      const since = new Date('2026-09-01T00:00:00.000Z');

      const result = await service.countDistinctEntitiesSince({
        userId: 'user-1',
        action: 'analysis.generated',
        since,
      });

      expect(result).toBe(3);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('log.user_id = :userId', {
        userId: 'user-1',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.action = :action', {
        action: 'analysis.generated',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.created_at >= :since', {
        since,
      });
    });

    it('counts DISTINCT entity_id, not raw row count', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '1' });

      await service.countDistinctEntitiesSince({
        userId: 'user-1',
        action: 'cover_letter.generated',
        since: new Date(),
      });

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'COUNT(DISTINCT log.entity_id)',
        'count',
      );
    });

    it('returns 0 when no matching rows exist', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '0' });

      const result = await service.countDistinctEntitiesSince({
        userId: 'user-1',
        action: 'tailoring.generated',
        since: new Date(),
      });

      expect(result).toBe(0);
    });

    it('returns 0 when getRawOne resolves undefined (defensive — should not normally happen)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(undefined);

      const result = await service.countDistinctEntitiesSince({
        userId: 'user-1',
        action: 'analysis.generated',
        since: new Date(),
      });

      expect(result).toBe(0);
    });
  });
});
