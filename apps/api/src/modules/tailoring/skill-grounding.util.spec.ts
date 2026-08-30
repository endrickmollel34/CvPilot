import type { CvContent } from '@cvpilot/shared';
import { isNewSkillGrounded } from './skill-grounding.util';

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
