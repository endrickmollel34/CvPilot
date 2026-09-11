import type { CvContent } from '@cvpilot/shared';

import type { CvEntity } from '../../entities/cv.entity';
import { redactRawCvTextForAi, resolveAiSafeCvText } from './ai-safe-cv-text.util';

function cv(overrides: Partial<CvEntity> = {}): Pick<CvEntity, 'content' | 'parsedContent'> {
  return { content: undefined, parsedContent: undefined, ...overrides };
}

const STRUCTURED_CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 555 123 4567',
    location: '123 Main St, Springfield',
    linkedIn: 'linkedin.com/in/janedoe',
    website: 'janedoe.dev',
    jobTitle: 'Senior Backend Engineer',
  },
  summary: 'Backend engineer with 5 years of experience building distributed systems.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme Corp',
      title: 'Senior Engineer',
      location: 'London, UK',
      startDate: '2022-01',
      current: true,
      bullets: [
        'Increased API throughput by 45% by redesigning the caching layer.',
        'Built a Node.js/PostgreSQL service handling 2M requests/day.',
      ],
    },
  ],
  education: [
    {
      id: 'ed-1',
      institution: 'University of Manchester',
      degree: 'BSc Computer Science',
      startDate: '2016-09',
      endDate: '2019-06',
    },
  ],
  skills: [{ id: 'sk-1', name: 'TypeScript' }],
  languages: [],
  certifications: [{ id: 'ce-1', name: 'AWS Certified Solutions Architect' }],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

describe('redactRawCvTextForAi()', () => {
  it('redacts a conventional email address', () => {
    const result = redactRawCvTextForAi('Contact: jane.doe@example.com for more info.');
    expect(result).not.toContain('jane.doe@example.com');
    expect(result).toContain('[redacted-email]');
  });

  it('redacts a LinkedIn personal-profile URL', () => {
    const result = redactRawCvTextForAi('LinkedIn: https://www.linkedin.com/in/janedoe123');
    expect(result).not.toContain('linkedin.com/in/janedoe123');
    expect(result).toContain('[redacted-linkedin]');
  });

  it('redacts a bare (no-protocol) LinkedIn personal-profile URL', () => {
    const result = redactRawCvTextForAi('linkedin.com/in/jane-doe');
    expect(result).not.toContain('linkedin.com/in/jane-doe');
  });

  it('does NOT touch a LinkedIn company page URL', () => {
    const result = redactRawCvTextForAi('Worked at https://www.linkedin.com/company/acme-corp');
    expect(result).toContain('linkedin.com/company/acme-corp');
  });

  it('redacts an internationally-formatted phone number (leading +)', () => {
    const result = redactRawCvTextForAi('Phone: +1 555 123 4567');
    expect(result).not.toContain('+1 555 123 4567');
    expect(result).toContain('[redacted-phone]');
  });

  it('redacts a UK-style international phone number with a parenthetical', () => {
    const result = redactRawCvTextForAi('Tel: +44 (0)20 7946 0958');
    expect(result).not.toContain('+44 (0)20 7946 0958');
  });

  // Documented, deliberate limitation — see the module doc comment.
  it('does NOT redact a bare/local-format phone number (no leading +) — reported limitation', () => {
    const result = redactRawCvTextForAi('Phone: 020 7946 0958');
    expect(result).toContain('020 7946 0958');
  });

  it('does not mistake a small "+N%" metric for a phone number', () => {
    const result = redactRawCvTextForAi('Increased conversion by +15% this quarter.');
    expect(result).toContain('+15%');
  });

  it('never mutates the original string — returns a new value, input is untouched', () => {
    const original = 'Email me at jane@example.com anytime.';
    const originalCopy = original;

    const result = redactRawCvTextForAi(original);

    expect(original).toBe(originalCopy); // JS strings are immutable, but assert the contract explicitly
    expect(original).toContain('jane@example.com');
    expect(result).not.toContain('jane@example.com');
  });

  // ─── Professional content must survive redaction untouched ────────────────

  it('preserves work experience, company names, dates, metrics, and technologies', () => {
    const raw = [
      'Jane Doe',
      'jane.doe@example.com | +1 555 123 4567',
      '',
      'WORK EXPERIENCE',
      'Senior Backend Engineer at Acme Corp, London, UK [2022-01 - Present]',
      '- Increased API throughput by 45% using Redis caching',
      '- Built a Node.js/PostgreSQL/Docker service handling 2,000,000 requests/day',
      '',
      'EDUCATION',
      'BSc Computer Science, University of Manchester [2016-09 - 2019-06]',
      '',
      'PROJECTS',
      'Open-source contribution: https://github.com/janedoe/rate-limiter',
    ].join('\n');

    const result = redactRawCvTextForAi(raw);

    expect(result).toContain('Acme Corp');
    expect(result).toContain('University of Manchester');
    expect(result).toContain('2022-01');
    expect(result).toContain('2016-09');
    expect(result).toContain('2019-06');
    expect(result).toContain('45%');
    expect(result).toContain('2,000,000 requests/day');
    expect(result).toContain('Redis');
    expect(result).toContain('Node.js');
    expect(result).toContain('PostgreSQL');
    expect(result).toContain('Docker');
    // Arbitrary project URLs (not linkedin.com/in/...) must survive — they
    // are evidence, not a contact identifier.
    expect(result).toContain('https://github.com/janedoe/rate-limiter');
    // But the contact block's email/phone are gone.
    expect(result).not.toContain('jane.doe@example.com');
    expect(result).not.toContain('+1 555 123 4567');
  });
});

describe('resolveAiSafeCvText()', () => {
  describe('raw parsedContent path (no usable structured content)', () => {
    it('returns a redacted copy of parsedContent without mutating the source CV row', () => {
      const source = cv({
        parsedContent: 'Jane Doe — jane@example.com — Senior Engineer at Acme Corp.',
      });

      const result = resolveAiSafeCvText(source, { includeFullName: false });

      expect(result).not.toContain('jane@example.com');
      expect(result).toContain('Acme Corp');
      // The CV row's own field is untouched.
      expect(source.parsedContent).toBe(
        'Jane Doe — jane@example.com — Senior Engineer at Acme Corp.',
      );
    });

    it('returns undefined when parsedContent is empty/whitespace-only and there is no structured content', () => {
      expect(resolveAiSafeCvText(cv({ parsedContent: '   ' }), { includeFullName: false })).toBe(
        undefined,
      );
    });
  });

  describe('structured content path — Analysis (includeFullName: false)', () => {
    it('excludes fullName, email, phone, location, linkedIn, and website', () => {
      const text = resolveAiSafeCvText(cv({ content: STRUCTURED_CONTENT }), {
        includeFullName: false,
      });

      expect(text).not.toContain('Jane Doe');
      expect(text).not.toContain('jane@example.com');
      expect(text).not.toContain('+1 555 123 4567');
      expect(text).not.toContain('123 Main St, Springfield');
      expect(text).not.toContain('linkedin.com/in/janedoe');
      expect(text).not.toContain('janedoe.dev');
    });

    it('preserves job title, work experience, education, skills, and certifications', () => {
      const text = resolveAiSafeCvText(cv({ content: STRUCTURED_CONTENT }), {
        includeFullName: false,
      });

      expect(text).toContain('Senior Backend Engineer');
      expect(text).toContain('Acme Corp');
      expect(text).toContain('London, UK'); // role location — professional context, not redacted
      expect(text).toContain('45%');
      expect(text).toContain('2M requests/day');
      expect(text).toContain('University of Manchester');
      expect(text).toContain('BSc Computer Science');
      expect(text).toContain('TypeScript');
      expect(text).toContain('AWS Certified Solutions Architect');
    });
  });

  describe('structured content path — Cover Letter (includeFullName: true)', () => {
    it('includes fullName and jobTitle but still excludes email, phone, location, linkedIn, and website', () => {
      const text = resolveAiSafeCvText(cv({ content: STRUCTURED_CONTENT }), {
        includeFullName: true,
      });

      expect(text).toContain('Jane Doe');
      expect(text).toContain('Senior Backend Engineer');
      expect(text).not.toContain('jane@example.com');
      expect(text).not.toContain('+1 555 123 4567');
      expect(text).not.toContain('123 Main St, Springfield');
      expect(text).not.toContain('linkedin.com/in/janedoe');
      expect(text).not.toContain('janedoe.dev');
    });

    it('still preserves all professional content', () => {
      const text = resolveAiSafeCvText(cv({ content: STRUCTURED_CONTENT }), {
        includeFullName: true,
      });

      expect(text).toContain('Acme Corp');
      expect(text).toContain('University of Manchester');
      expect(text).toContain('TypeScript');
      expect(text).toContain('AWS Certified Solutions Architect');
    });
  });

  it('prefers structured content over a stale parsedContent when both are present', () => {
    const text = resolveAiSafeCvText(
      cv({ parsedContent: 'Stale original extraction.', content: STRUCTURED_CONTENT }),
      { includeFullName: true },
    );

    expect(text).not.toBe('Stale original extraction.');
    expect(text).toContain('Acme Corp');
  });
});
