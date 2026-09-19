import { GUARDS_METADATA } from '@nestjs/common/constants';

import { AnalysisController } from '../../modules/analysis/analysis.controller';
import { CoverLetterController } from '../../modules/cover-letter/cover-letter.controller';
import { TailoringController } from '../../modules/tailoring/tailoring.controller';
import { CvController } from '../../modules/cv/cv.controller';
import { AiRateLimitGuard } from './ai-rate-limit.guard';

/**
 * Confirms AiRateLimitGuard is wired onto EXACTLY the five real paid-AI
 * routes traced for RABBIT_NOTEBOOK.md (POST /analyses, POST
 * /cover-letters, POST /cover-letters/:id/regenerate, POST /tailorings,
 * POST /cvs/:id/prefill) and nowhere else in these four controllers — a
 * plain reflection check on `@UseGuards` metadata, independent of and
 * complementary to the HTTP-level integration test
 * (ai-rate-limit.guard.integration.spec.ts), which proves the guard
 * actually BLOCKS a request; this test proves it's attached to the right
 * handlers in the first place; a wiring mistake here (guard on the wrong
 * method, or missing from one of the five) wouldn't be caught by that
 * test alone, since it only exercises whichever single route it targets.
 */
function guardedWith(target: object, methodName: string, guard: unknown): boolean {
  const method = (target as Record<string, unknown>)[methodName];
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, method as object) ?? [];
  return guards.includes(guard);
}

describe('AiRateLimitGuard wiring', () => {
  it('is present on all five real paid-AI-triggering route handlers', () => {
    expect(guardedWith(AnalysisController.prototype, 'submitAnalysis', AiRateLimitGuard)).toBe(
      true,
    );
    expect(guardedWith(CoverLetterController.prototype, 'submit', AiRateLimitGuard)).toBe(true);
    expect(guardedWith(CoverLetterController.prototype, 'regenerate', AiRateLimitGuard)).toBe(true);
    expect(guardedWith(TailoringController.prototype, 'submit', AiRateLimitGuard)).toBe(true);
    expect(guardedWith(CvController.prototype, 'prefill', AiRateLimitGuard)).toBe(true);
  });

  it('is absent from every non-AI route on the same four controllers (no over-application)', () => {
    // AnalysisController: read/delete/status routes never call AI directly.
    expect(guardedWith(AnalysisController.prototype, 'listAnalyses', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(AnalysisController.prototype, 'getAnalysis', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(AnalysisController.prototype, 'deleteAnalysis', AiRateLimitGuard)).toBe(
      false,
    );
    expect(guardedWith(AnalysisController.prototype, 'statusStream', AiRateLimitGuard)).toBe(false);

    // CoverLetterController: list/find/update/delete/download don't call AI
    // — only submit() and regenerate() do (checked above).
    expect(guardedWith(CoverLetterController.prototype, 'list', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CoverLetterController.prototype, 'findOne', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CoverLetterController.prototype, 'update', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CoverLetterController.prototype, 'remove', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CoverLetterController.prototype, 'download', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CoverLetterController.prototype, 'statusStream', AiRateLimitGuard)).toBe(
      false,
    );

    // TailoringController: apply() applies already-generated suggestions to
    // CV content — no new AI call — so it must NOT be guarded.
    expect(guardedWith(TailoringController.prototype, 'list', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(TailoringController.prototype, 'findOne', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(TailoringController.prototype, 'remove', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(TailoringController.prototype, 'apply', AiRateLimitGuard)).toBe(false);

    // CvController: every route except prefill() is plain CRUD/upload —
    // no AI call anywhere else in this controller.
    expect(guardedWith(CvController.prototype, 'create', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CvController.prototype, 'updateContent', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CvController.prototype, 'deleteCv', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CvController.prototype, 'getUploadUrl', AiRateLimitGuard)).toBe(false);
    expect(guardedWith(CvController.prototype, 'confirmUpload', AiRateLimitGuard)).toBe(false);
  });
});
