import {
  validatePhotoFile,
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_FILE_SIZE_BYTES,
} from './validatePhotoFile';

function pngFile(name = 'photo.png', sizeBytes = 1024) {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/png' });
}

function jpegFile(name = 'photo.jpg', sizeBytes = 1024) {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/jpeg' });
}

describe('ACCEPTED_PHOTO_TYPES', () => {
  it('accepts PNG and JPEG only', () => {
    expect(ACCEPTED_PHOTO_TYPES).toContain('image/png');
    expect(ACCEPTED_PHOTO_TYPES).toContain('image/jpeg');
    expect(ACCEPTED_PHOTO_TYPES).toHaveLength(2);
  });
});

// UX-only, no-round-trip validation — see this module's own doc comment.
// CvPhotoService.confirmUpload's real byte-level check is the actual
// source of truth and is covered separately (cv-photo.service.spec.ts).
describe('validatePhotoFile()', () => {
  it('accepts a PNG under 3 MB', () => {
    expect(validatePhotoFile(pngFile('photo.png', 1024))).toEqual({ valid: true });
  });

  it('accepts a JPEG under 3 MB', () => {
    expect(validatePhotoFile(jpegFile('photo.jpg', 1024))).toEqual({ valid: true });
  });

  it('rejects an unsupported MIME type (e.g. a PDF)', () => {
    const file = new File(['data'], 'resume.pdf', { type: 'application/pdf' });
    expect(validatePhotoFile(file)).toEqual({
      valid: false,
      message: 'Please upload a PNG or JPEG image.',
    });
  });

  it('accepts a file exactly 3 MB (boundary, not rejected)', () => {
    expect(validatePhotoFile(pngFile('photo.png', MAX_PHOTO_FILE_SIZE_BYTES))).toEqual({
      valid: true,
    });
  });

  it('rejects a file over 3 MB', () => {
    expect(validatePhotoFile(pngFile('photo.png', MAX_PHOTO_FILE_SIZE_BYTES + 1))).toEqual({
      valid: false,
      message: 'Profile photos must be 3 MB or smaller.',
    });
  });
});
