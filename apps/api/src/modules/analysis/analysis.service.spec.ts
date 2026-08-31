import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';

import { AnalysisService } from './analysis.service';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { AtsReportEntity } from '../../entities/ats-report.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AiService } from './ai.service';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

// Focused on the relation-loading change (History Phase 1) — not a full
// spec of submit()/process(), which are unaffected by this change.
describe('AnalysisService — history relation loading', () => {
  let service: AnalysisService;

  const mockAnalysisRepo = { find: jest.fn(), findOne: jest.fn() };
  const mockAtsRepo = { create: jest.fn(), save: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAiService = { runAnalysis: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getRepositoryToken(AtsReportEntity), useValue: mockAtsRepo },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
  });

  describe('listForUser()', () => {
    it('requests both the atsReport and cv relations', async () => {
      mockAnalysisRepo.find.mockResolvedValue([]);

      await service.listForUser('clerk-1');

      expect(mockAnalysisRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          relations: ['atsReport', 'cv'],
        }),
      );
    });

    it('returns analyses with their cv relation populated when the source CV still exists', async () => {
      const withCv = {
        id: 'an-1',
        cv: { id: 'cv-1', title: 'My CV', fileName: undefined, source: 'builder' },
      };
      mockAnalysisRepo.find.mockResolvedValue([withCv]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.cv).toEqual(withCv.cv);
    });

    it('tolerates a missing cv relation (source CV since deleted) without throwing', async () => {
      mockAnalysisRepo.find.mockResolvedValue([{ id: 'an-1', cv: undefined }]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.cv).toBeUndefined();
    });
  });

  describe('findOneForUser()', () => {
    it('requests both the atsReport and cv relations', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue({ id: 'an-1', userId: 'user-1' });

      await service.findOneForUser('clerk-1', 'an-1');

      expect(mockAnalysisRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'an-1', userId: 'user-1' },
        relations: ['atsReport', 'cv'],
      });
    });

    it('throws NotFoundException for a non-owned or non-existent analysis id', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser('clerk-1', 'not-mine')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
