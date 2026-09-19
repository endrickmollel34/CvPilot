// Mirrors apps/api's ALLOWED_PHOTO_MIME_TYPES/MAX_PHOTO_SIZE_BYTES
// (dto/photo-upload-url.dto.ts) — UX-only, an early no-round-trip
// rejection. The backend's own @IsIn/@Max validators, plus
// CvPhotoService.confirmUpload's real byte-level PNG/JPEG check, are the
// actual source of truth and must never be assumed redundant with this.
export const ACCEPTED_PHOTO_TYPES = ['image/png', 'image/jpeg'];
export const MAX_PHOTO_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

export type PhotoFileValidationResult = { valid: true } | { valid: false; message: string };

export function validatePhotoFile(file: File): PhotoFileValidationResult {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return { valid: false, message: 'Please upload a PNG or JPEG image.' };
  }
  if (file.size > MAX_PHOTO_FILE_SIZE_BYTES) {
    return { valid: false, message: 'Profile photos must be 3 MB or smaller.' };
  }
  return { valid: true };
}
