import type { CvEntity } from '../../entities/cv.entity';
import { resolveAiSafeCvText } from '../../common/utils/ai-safe-cv-text.util';

/**
 * Resolves the CV text to ground cover-letter generation in, and to send to
 * the AI provider — see ai-safe-cv-text.util.ts for the shared, privacy-
 * minimizing structured/raw resolution this delegates to (also used by
 * Analysis). Cover Letter passes `includeFullName: true`: the letter
 * genuinely needs the candidate's name (used to address it), unlike
 * Analysis's match-scoring, which never does. Email/phone/location/
 * LinkedIn/website are never included for either caller.
 *
 * Upload CVs only ever populate `parsedContent` (raw text extracted from the
 * PDF/DOCX by ParsingService) — `content` stays unset, since CvService's
 * updateContent() forbids editing upload-sourced CVs. Builder/prefill/
 * tailored CVs are the opposite: their usable content lives entirely in the
 * structured `content` field, and `parsedContent` is never populated —
 * CvService.createBuilder/prefillFromUpload/createTailored all mark
 * parseStatus 'done' immediately without ever queuing a parsing job. A CV
 * with `content` set is preferred when both happen to be present, since it
 * reflects the user's current edits rather than the original upload's
 * extraction.
 *
 * Returns undefined when neither source has genuinely usable content, so
 * callers can treat that the same as "still parsing" — including a
 * structured `content` that is present but empty (e.g. saved before the
 * user filled anything in), which must not bypass validation.
 */
export function resolveCoverLetterCvText(cv: CvEntity): string | undefined {
  return resolveAiSafeCvText(cv, { includeFullName: true });
}
