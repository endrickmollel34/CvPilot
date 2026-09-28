import type { CvContent } from '@cvpilot/shared';
import { isNewSkillGrounded, isSkillAlreadyCovered } from './skill-grounding.util';

const CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com', jobTitle: 'Engineer' },
  summary: 'Experienced engineer who has built RESTful services for high-traffic checkout flows.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      current: true,
      bullets: [
        'Administered a MySQL database for order processing',
        'Used JavaScript to build the storefront frontend',
      ],
    },
  ],
  education: [],
  skills: [{ id: 'sk-1', name: 'TypeScript' }],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

describe('isNewSkillGrounded()', () => {
  it('allows a skill that already exists on the CV, evidence or not', () => {
    expect(isNewSkillGrounded('TypeScript', undefined, CONTENT)).toBe(true);
    expect(isNewSkillGrounded('typescript', undefined, CONTENT)).toBe(true); // case-insensitive
  });

  it('rejects a new skill with no evidence at all', () => {
    expect(isNewSkillGrounded('Docker', undefined, CONTENT)).toBe(false);
    expect(isNewSkillGrounded('Docker', '', CONTENT)).toBe(false);
    expect(isNewSkillGrounded('Docker', '   ', CONTENT)).toBe(false);
  });

  it('rejects evidence that is not actually present in the CV (fabricated/JD-lifted evidence)', () => {
    expect(isNewSkillGrounded('Docker', 'The team uses Docker for all deployments', CONTENT)).toBe(
      false,
    );
  });

  it('rejects evidence that is present in the CV but unrelated to the claimed skill', () => {
    // "Used JavaScript..." is a real bullet, but it does not support "Java" —
    // this is the classic Java/JavaScript confusion and must stay rejected.
    expect(
      isNewSkillGrounded('Java', 'Used JavaScript to build the storefront frontend', CONTENT),
    ).toBe(false);
  });

  it('allows a skill directly evidenced by an exact bullet quote', () => {
    expect(
      isNewSkillGrounded('MySQL', 'Administered a MySQL database for order processing', CONTENT),
    ).toBe(true);
  });

  it('allows safe terminology normalization (RESTful services → REST APIs)', () => {
    expect(
      isNewSkillGrounded(
        'REST APIs',
        'Experienced engineer who has built RESTful services for high-traffic checkout flows.',
        CONTENT,
      ),
    ).toBe(true);
  });

  it('rejects when the quoted evidence does not match the actual CV text', () => {
    // Evidence text is plausible-sounding but was not actually said in the CV.
    expect(isNewSkillGrounded('Python', 'Wrote Python scripts for data cleanup', CONTENT)).toBe(
      false,
    );
  });
});

// Fix (RABBIT_NOTEBOOK.md §52): confirmed against a real production
// tailoring result — a CV whose skills were saved as one compound entry
// ("Programming Languages: Html, CSS, Java, C++, Python") produced
// "Suggested: HTML" / "Suggested: CSS" addition cards that read as
// confusing duplicates, since both are already spelled out in that one
// entry. Isolated, synthetic test data below — never the real CV.
describe('isSkillAlreadyCovered()', () => {
  const COMPOUND_SKILLS_CONTENT: CvContent = {
    version: 1,
    personalDetails: { fullName: 'Test Candidate', email: 'test@example.com' },
    workExperience: [],
    education: [],
    skills: [
      { id: 'sk-1', name: 'Programming Languages: HTML, CSS, Java, Python' },
      { id: 'sk-2', name: 'Fast and accurate typing' },
    ],
    languages: [{ id: 'lang-1', name: 'Spoken languages: English, French' }],
    certifications: [],
    sectionOrder: [
      'summary',
      'workExperience',
      'education',
      'skills',
      'languages',
      'certifications',
    ],
  };

  it('recognises a skill already spelled out inside a compound existing entry', () => {
    expect(isSkillAlreadyCovered('HTML', COMPOUND_SKILLS_CONTENT)).toBe(true);
    expect(isSkillAlreadyCovered('CSS', COMPOUND_SKILLS_CONTENT)).toBe(true);
    expect(isSkillAlreadyCovered('Java', COMPOUND_SKILLS_CONTENT)).toBe(true);
  });

  it('recognises a language already spelled out inside a compound existing entry', () => {
    expect(isSkillAlreadyCovered('English', COMPOUND_SKILLS_CONTENT)).toBe(true);
  });

  it('does not match a genuinely different skill that only shares a substring', () => {
    // "Java" must not match inside "JavaScript" (the substring risk this
    // module's whole-word containment is specifically designed to avoid).
    const content: CvContent = {
      ...COMPOUND_SKILLS_CONTENT,
      skills: [{ id: 'sk-1', name: 'JavaScript' }],
    };
    expect(isSkillAlreadyCovered('Java', content)).toBe(false);
  });

  it('returns false for a skill genuinely absent from every existing entry', () => {
    expect(isSkillAlreadyCovered('Kubernetes', COMPOUND_SKILLS_CONTENT)).toBe(false);
  });
});
