// Single source of truth — both current upload entry points (NewCvUpload,
// AnalysisWorkspace) previously each declared their own identical copy of
// this list; both now import validateCvFile from here instead. Kept in this
// plain .ts module — not CvDropzone.tsx itself — specifically so it (and
// resolveDroppedCvFile below) can be unit-tested with this repo's existing
// Jest setup, which does not resolve .tsx modules.
export const ACCEPTED_CV_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export type DroppedFileResult = { file: File } | { rejected: string };

/**
 * Decides what to do with a drag-and-drop file list, independent of any DOM
 * rendering — kept in its own plain module (not inside CvDropzone.tsx) so it
 * can be unit-tested with this repo's existing node-environment Jest setup,
 * without needing jsdom/React Testing Library.
 *
 * Only ever decides "how many files, if any" — per-file type/size
 * validation for the single resolved file is a separate step (see
 * validateCvFile below), applied identically regardless of whether the file
 * came from here or from a plain click/file-picker selection.
 */
export function resolveDroppedCvFile(files: FileList | File[]): DroppedFileResult | undefined {
  const list = Array.from(files);
  if (list.length === 0) return undefined;
  if (list.length > 1) return { rejected: 'Please drop a single CV file.' };
  return { file: list[0]! };
}

// Mirrors apps/api's MAX_FILE_SIZE_BYTES (generate-upload-url.dto.ts) —
// kept as a separate frontend constant rather than importing across the
// package boundary; this check is UX only (an early, no-round-trip
// rejection), never the source of truth. The backend's own @Max validator
// is what actually enforces the limit and must never be removed or relied
// on to be redundant with this one.
export const MAX_CV_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type CvFileValidationResult = { valid: true } | { valid: false; message: string };

/**
 * The single, shared CV-file validator — both NewCvUpload.tsx and
 * AnalysisWorkspace.tsx call this from their own handleFileSelected(file),
 * itself reached identically whether the file came from a click/file-picker
 * selection or a CvDropzone drop, BEFORE getUploadUrl() is ever called. A
 * rejected file never starts the upload pipeline (no getUploadUrl call, no
 * PUT to R2) — see each page's own handleFileSelected for the early return.
 */
export function validateCvFile(file: File): CvFileValidationResult {
  if (!ACCEPTED_CV_TYPES.includes(file.type)) {
    return { valid: false, message: 'Please upload a PDF or DOCX file.' };
  }
  if (file.size > MAX_CV_FILE_SIZE_BYTES) {
    return { valid: false, message: 'CV files must be 5 MB or smaller.' };
  }
  return { valid: true };
}
