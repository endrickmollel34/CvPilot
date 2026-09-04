import type { CvContent } from '@cvpilot/shared';
import type { CvEntity } from '../../entities/cv.entity';
import { resolveCoverLetterCvText } from './cv-text-resolver.util';

const EMPTY_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: '', email: '' },
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: [],
};

const STRUCTURED_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com', jobTitle: 'Engineer' },
  summary: 'Experienced backend engineer.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      current: true,
      bullets: ['Built RESTful services for the checkout flow'],
    },
  ],
  education: [],
  skills: [{ id: 'sk-1', name: 'TypeScript' }],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

function cv(overrides: Partial<CvEntity> = {}): CvEntity {
  return {
    id: 'cv-1',
    userId: 'user-1',
    source: 'upload',
    parseStatus: 'done',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CvEntity;
}

describe('resolveCoverLetterCvText()', () => {
  it('returns the raw parsed text for an upload CV that has finished parsing', () => {
    const text = resolveCoverLetterCvText(
      cv({ source: 'upload', parsedContent: 'Software engineer with 3 years experience.' }),
    );
    expect(text).toBe('Software engineer with 3 years experience.');
  });

  it('returns undefined for an upload CV that is still parsing (no parsedContent, no structured content)', () => {
    expect(
      resolveCoverLetterCvText(
        cv({ source: 'upload', parseStatus: 'pending', parsedContent: undefined }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined for an upload CV whose parsing failed', () => {
    expect(
      resolveCoverLetterCvText(
        cv({ source: 'upload', parseStatus: 'failed', parsedContent: undefined }),
      ),
    ).toBeUndefined();
  });

  it('serializes structured content for a builder/prefill/tailored CV that never has parsedContent (the bug scenario)', () => {
    const text = resolveCoverLetterCvText(
      cv({ source: 'prefill', parsedContent: undefined, content: STRUCTURED_CONTENT }),
    );
    expect(text).toBeDefined();
    expect(text).toContain('Jane Doe');
    expect(text).toContain('TypeScript');
    expect(text).toContain('Built RESTful services for the checkout flow');
  });

  it('returns undefined when structured content is present but empty (malformed/empty content must not bypass validation)', () => {
    expect(
      resolveCoverLetterCvText(cv({ source: 'builder', content: EMPTY_CONTENT })),
    ).toBeUndefined();
  });

  it('returns undefined for a freshly-created builder CV with no content at all', () => {
    expect(
      resolveCoverLetterCvText(
        cv({ source: 'builder', parsedContent: undefined, content: undefined }),
      ),
    ).toBeUndefined();
  });

  it('prefers structured content over parsedContent when both happen to be present', () => {
    const text = resolveCoverLetterCvText(
      cv({ parsedContent: 'Stale original extraction text.', content: STRUCTURED_CONTENT }),
    );
    expect(text).toContain('Jane Doe');
    expect(text).not.toBe('Stale original extraction text.');
  });

  it('treats whitespace-only parsedContent as unusable', () => {
    expect(resolveCoverLetterCvText(cv({ parsedContent: '   ' }))).toBeUndefined();
  });
});
