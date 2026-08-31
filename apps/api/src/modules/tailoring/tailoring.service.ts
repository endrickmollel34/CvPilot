import { randomUUID } from 'crypto';

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, MoreThanOrEqual, Not } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { PLAN_LIMITS } from '@cvpilot/shared';
import type {
  CvContent,
  TailoringSuggestion,
  TailoringDecision,
  TailoringStatus,
} from '@cvpilot/shared';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { isDevQuotaBypassActive } from '../../common/utils/dev-quota-bypass.util';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { CvService } from '../cv/cv.service';
import { TailoringAiService } from './tailoring-ai.service';
import { isNewSkillGrounded } from './skill-grounding.util';
import type { CreateTailoringDto } from './dto/create-tailoring.dto';
import type { ApplySuggestionsDto } from './dto/apply-suggestions.dto';

@Injectable()
export class TailoringService {
  private readonly logger = new Logger(TailoringService.name);

  constructor(
    @InjectRepository(TailoringEntity)
    private readonly tailoringRepo: Repository<TailoringEntity>,
    @InjectQueue('cv-tailoring')
    private readonly tailoringQueue: Queue,
    private readonly userService: UserService,
    private readonly billingService: BillingService,
    private readonly cvService: CvService,
    private readonly tailoringAiService: TailoringAiService,
  ) {}

  async submit(clerkId: string, dto: CreateTailoringDto): Promise<TailoringEntity> {
    const user = await this.userService.findByClerkId(clerkId);
    await this.checkTailoringLimit(user.id);

    const cv = await this.cvService.findById(dto.cvId);
    if (cv.userId !== user.id) {
      throw new ForbiddenException('CV not found');
    }
    if (!cv.content) {
      throw new UnprocessableEntityException(
        'Only CVs with structured content (built, prefilled, or tailored) can be used as a master CV.',
      );
    }

    const tailoring = this.tailoringRepo.create({
      userId: user.id,
      masterCvId: dto.cvId,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      jobDescription: dto.jobDescription,
      status: 'pending',
    });
    const saved = await this.tailoringRepo.save(tailoring);
    await this.tailoringQueue.add('run-tailoring', { tailoringId: saved.id });
    return saved;
  }

  // Called by TailoringProcessor — no auth check needed (internal).
  async runTailoring(tailoringId: string): Promise<void> {
    this.logger.log(`Running tailoring ${tailoringId}`);
    await this.tailoringRepo.update(tailoringId, { status: 'processing' });

    try {
      const tailoring = await this.tailoringRepo.findOneByOrFail({ id: tailoringId });
      const masterCv = await this.cvService.findById(tailoring.masterCvId);

      if (!masterCv.content) {
        throw new Error(`Master CV ${tailoring.masterCvId} has no structured content`);
      }

      const {
        suggestions: raw,
        modelUsed,
        tokensUsed,
      } = await this.tailoringAiService.runTailoring(masterCv.content, tailoring.jobDescription);

      const grounded = raw.filter((s) => {
        if (s.section !== 'skills' && s.section !== 'languages') return true;
        return isNewSkillGrounded(s.suggestedContent, s.evidence, masterCv.content!);
      });
      const droppedCount = raw.length - grounded.length;
      if (droppedCount > 0) {
        this.logger.warn(
          `Tailoring ${tailoringId}: dropped ${droppedCount} skill/language suggestion(s) not ` +
            'grounded in the source CV (see skill-grounding.util.ts)',
        );
      }

      const suggestions = sortSuggestions(grounded);

      this.logger.log(
        `Tailoring ${tailoringId} complete: ${suggestions.length} suggestions, model=${modelUsed}, tokens=${tokensUsed}`,
      );

      await this.tailoringRepo.update(tailoringId, {
        suggestions,
        modelUsed,
        tokensUsed,
        status: 'done',
        completedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`Tailoring ${tailoringId} failed`, err);
      await this.tailoringRepo.update(tailoringId, { status: 'failed' });
    }
  }

  async findOneForUser(clerkId: string, tailoringId: string): Promise<TailoringEntity> {
    const user = await this.userService.findByClerkId(clerkId);
    const tailoring = await this.tailoringRepo.findOne({
      where: { id: tailoringId, userId: user.id },
      // LEFT JOINs — resolve to undefined rather than excluding the row if
      // either CV has since been (soft-)deleted.
      relations: ['masterCv', 'tailoredCv'],
    });
    if (!tailoring) throw new NotFoundException(`Tailoring ${tailoringId} not found`);
    return tailoring;
  }

  async listForUser(clerkId: string): Promise<TailoringEntity[]> {
    const user = await this.userService.findByClerkId(clerkId);
    return this.tailoringRepo.find({
      where: { userId: user.id },
      // Single query with two LEFT JOINs — avoids N+1 lookups for the
      // history list, same pattern as AnalysisService/CoverLetterService.
      relations: ['masterCv', 'tailoredCv'],
      order: { createdAt: 'DESC' },
    });
  }

  async apply(
    clerkId: string,
    tailoringId: string,
    dto: ApplySuggestionsDto,
  ): Promise<{ tailoredCvId: string }> {
    const tailoring = await this.findOneForUser(clerkId, tailoringId);

    if (tailoring.status !== 'done') {
      throw new UnprocessableEntityException('Tailoring is not complete yet.');
    }
    if (!tailoring.suggestions?.length) {
      throw new UnprocessableEntityException('No suggestions available to apply.');
    }
    if (tailoring.tailoredCvId) {
      throw new ConflictException('This tailoring has already been applied.');
    }

    const masterCv = await this.cvService.findById(tailoring.masterCvId);
    if (!masterCv.content) {
      throw new UnprocessableEntityException('Master CV no longer has structured content.');
    }

    const tailoredContent = applyDecisions(masterCv.content, tailoring.suggestions, dto.decisions);

    const user = await this.userService.findByClerkId(clerkId);
    const tailoredCv = await this.cvService.createTailored(
      user.id,
      tailoredContent,
      tailoring.jobTitle,
    );

    await this.tailoringRepo.update(tailoringId, {
      tailoredCvId: tailoredCv.id,
      decisions: dto.decisions,
      status: 'applied',
    });

    return { tailoredCvId: tailoredCv.id };
  }

  private async checkTailoringLimit(userId: string): Promise<void> {
    // DEV-ONLY quota bypass — see dev-quota-bypass.util.ts for the full
    // rationale. Never active outside NODE_ENV=development.
    if (isDevQuotaBypassActive()) return;

    const plan = await this.billingService.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].tailoringsPerMonth;
    if (limit === Infinity) return;

    if (limit === 0) {
      throw new ForbiddenException(
        'Job tailoring is a Pro feature. Upgrade your plan to tailor your CV.',
      );
    }

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const count = await this.tailoringRepo.count({
      where: {
        userId,
        status: Not('failed') as unknown as TailoringStatus,
        createdAt: MoreThanOrEqual(startOfMonth),
      },
    });

    if (count >= limit) {
      throw new ForbiddenException(
        'Monthly tailoring limit reached. Upgrade your plan to continue.',
      );
    }
  }
}

// ── Sort order ───────────────────────────────────────────────────────────────
// Priority: High Impact → Worth Improving → Optional Enhancement
// Section within each priority group: Summary → Experience → Skills →
//   Education → Languages → Certifications
// Sorted here in the service so the UI always receives a stable order
// regardless of which model produced the suggestions.

const SUGGESTION_PRIORITY_ORDER: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const SUGGESTION_SECTION_ORDER: Record<string, number> = {
  summary: 0,
  workExperience: 1,
  skills: 2,
  education: 3,
  languages: 4,
  certifications: 5,
};

function sortSuggestions(suggestions: TailoringSuggestion[]): TailoringSuggestion[] {
  return [...suggestions].sort((a, b) => {
    const pDiff =
      (SUGGESTION_PRIORITY_ORDER[a.priority] ?? 3) - (SUGGESTION_PRIORITY_ORDER[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    return (SUGGESTION_SECTION_ORDER[a.section] ?? 6) - (SUGGESTION_SECTION_ORDER[b.section] ?? 6);
  });
}

// Applies accepted decisions to a deep clone of the master CvContent.
function applyDecisions(
  masterContent: CvContent,
  suggestions: TailoringSuggestion[],
  decisions: TailoringDecision[],
): CvContent {
  const content: CvContent = JSON.parse(JSON.stringify(masterContent)) as CvContent;

  for (const decision of decisions) {
    if (decision.decision === 'rejected') continue;

    const suggestion = suggestions.find((s) => s.id === decision.suggestionId);
    if (!suggestion) continue;

    const text = decision.editedContent ?? suggestion.suggestedContent;

    switch (suggestion.section) {
      case 'summary':
        content.summary = text;
        break;

      case 'workExperience': {
        const original = suggestion.originalContent;
        if (!original) break;
        for (const entry of content.workExperience) {
          const idx = entry.bullets.findIndex((b) => b === original);
          if (idx !== -1) {
            entry.bullets[idx] = text;
            break;
          }
        }
        break;
      }

      case 'skills':
        // Second grounding check (defense in depth) — re-verify against the
        // pristine master CV even if this suggestion was somehow persisted
        // ungrounded (e.g. stored before this check existed), so it still
        // cannot be written into the tailored CV.
        if (
          isNewSkillGrounded(text, suggestion.evidence, masterContent) &&
          !content.skills.some((s) => s.name.toLowerCase() === text.toLowerCase())
        ) {
          content.skills.push({ id: randomUUID(), name: text });
        }
        break;

      case 'languages':
        if (
          isNewSkillGrounded(text, suggestion.evidence, masterContent) &&
          !content.languages.some((l) => l.name.toLowerCase() === text.toLowerCase())
        ) {
          content.languages.push({ id: randomUUID(), name: text });
        }
        break;

      // education and certifications: complex matching — skip for MVP
    }
  }

  return content;
}
