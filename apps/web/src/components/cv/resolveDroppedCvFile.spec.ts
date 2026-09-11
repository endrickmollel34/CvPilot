import {
  resolveDroppedCvFile,
  validateCvFile,
  ACCEPTED_CV_TYPES,
  MAX_CV_FILE_SIZE_BYTES,
} from './resolveDroppedCvFile';

function pdfFile(name = 'resume.pdf', sizeBytes = 1024) {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

function docxFile(name = 'resume.docx', sizeBytes = 1024) {
  return new File([new Uint8Array(sizeBytes)], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('resolveDroppedCvFile()', () => {
  it('resolves a single valid PDF dropped', () => {
    const file = pdfFile();

    const result = resolveDroppedCvFile([file]);

    expect(result).toEqual({ file });
  });

  it('resolves a single valid DOCX dropped', () => {
    const file = docxFile();

    const result = resolveDroppedCvFile([file]);

    expect(result).toEqual({ file });
  });

  it('rejects when multiple files are dropped in one gesture', () => {
    const result = resolveDroppedCvFile([pdfFile('a.pdf'), pdfFile('b.pdf')]);

    expect(result).toEqual({ rejected: 'Please drop a single CV file.' });
  });

  it('rejects three or more files dropped at once, same as two', () => {
    const result = resolveDroppedCvFile([pdfFile('a.pdf'), docxFile('b.docx'), pdfFile('c.pdf')]);

    expect(result && 'rejected' in result).toBe(true);
  });

  it('returns undefined for an empty file list (e.g. a non-file drag ending over the zone)', () => {
    expect(resolveDroppedCvFile([])).toBeUndefined();
  });

  // The dropzone itself only ever decides "how many files" — it deliberately
  // does NOT inspect file.type or file.size. Per-file validation (PDF/DOCX
  // only, size limit) stays owned entirely by the caller's existing
  // handleFileSelected, reached via the same onFile callback used for a
  // click-selected file — see CvDropzone.tsx's own doc comment. A file of
  // any MIME type or size is resolved here exactly the same way; rejecting
  // an unsupported type or an oversized file is proven by NewCvUpload.tsx/
  // AnalysisWorkspace.tsx already funnelling both the click path and this
  // drop path into that one identical function, not by this module.
  it('resolves a single file regardless of its MIME type — type validation is the caller’s responsibility, not the dropzone’s', () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' });

    expect(resolveDroppedCvFile([file])).toEqual({ file });
  });
});

describe('ACCEPTED_CV_TYPES', () => {
  it('accepts PDF and DOCX only — the single source both upload entry points import', () => {
    expect(ACCEPTED_CV_TYPES).toContain('application/pdf');
    expect(ACCEPTED_CV_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(ACCEPTED_CV_TYPES).toHaveLength(2);
  });
});

// The single shared validator called by both NewCvUpload.tsx and
// AnalysisWorkspace.tsx from their own handleFileSelected(file), before
// getUploadUrl() is ever called — reached identically whether the file came
// from a click/file-picker selection or a CvDropzone drop.
describe('validateCvFile()', () => {
  it('accepts a PDF under 5 MB', () => {
    const file = pdfFile('resume.pdf', 1024);

    expect(validateCvFile(file)).toEqual({ valid: true });
  });

  it('accepts a DOCX under 5 MB', () => {
    const file = docxFile('resume.docx', 1024);

    expect(validateCvFile(file)).toEqual({ valid: true });
  });

  it('rejects an unsupported MIME type', () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' });

    expect(validateCvFile(file)).toEqual({
      valid: false,
      message: 'Please upload a PDF or DOCX file.',
    });
  });

  it('accepts a file exactly 5 MB (boundary, not rejected)', () => {
    const file = pdfFile('resume.pdf', MAX_CV_FILE_SIZE_BYTES);

    expect(validateCvFile(file)).toEqual({ valid: true });
  });

  it('rejects a file over 5 MB', () => {
    const file = pdfFile('resume.pdf', MAX_CV_FILE_SIZE_BYTES + 1);

    expect(validateCvFile(file)).toEqual({
      valid: false,
      message: 'CV files must be 5 MB or smaller.',
    });
  });
});
