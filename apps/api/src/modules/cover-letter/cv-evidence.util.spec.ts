import type { CvContent } from '@cvpilot/shared';
import { buildCvEvidenceFromContent, buildCvEvidenceFromPlainText } from './cv-evidence.util';

describe('buildCvEvidenceFromContent()', () => {
  const CONTENT: CvContent = {
    version: 1,
    personalDetails: {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      jobTitle: 'Backend Engineer',
    },
    summary: 'Backend engineer with a focus on reliable services.',
    workExperience: [
      {
        id: 'we-1',
        company: 'Toyota Tanzania',
        title: 'Software Engineer',
        startDate: '2022-01',
        current: true,
        bullets: [
          'Developed backend services',
          'Maintained applications',
          'Debugged software issues',
        ],
      },
    ],
    education: [
      {
        id: 'ed-1',
        institution: 'University of Dar es Salaam',
        degree: 'BSc',
        field: 'Computer Science',
      },
    ],
    skills: [
      { id: 'sk-1', name: 'Python' },
      { id: 'sk-2', name: 'REST APIs' },
      { id: 'sk-3', name: 'Database Design' },
    ],
    languages: [{ id: 'lg-1', name: 'Swahili' }],
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

  it('puts work experience bullets, titles, and education in experienceText', () => {
    const evidence = buildCvEvidenceFromContent(CONTENT);
    expect(evidence.experienceText).toContain('Toyota Tanzania');
    expect(evidence.experienceText).toContain('Developed backend services');
    expect(evidence.experienceText).toContain('University of Dar es Salaam');
  });

  it('does not put skills-only terms in experienceText', () => {
    const evidence = buildCvEvidenceFromContent(CONTENT);
    // "REST APIs" is listed as a skill but never mentioned in a work bullet.
    expect(evidence.experienceText).not.toContain('REST APIs');
    expect(evidence.experienceText).not.toContain('Database Design');
  });

  it('puts skills and languages in skillsOnlyTerms', () => {
    const evidence = buildCvEvidenceFromContent(CONTENT);
    expect(evidence.skillsOnlyTerms).toEqual(
      expect.arrayContaining(['Python', 'REST APIs', 'Database Design', 'Swahili']),
    );
  });
});

describe('buildCvEvidenceFromPlainText()', () => {
  const CV_WITH_HEADERS = [
    'Jane Doe',
    'Software Engineer',
    '',
    'Experience',
    'Toyota Tanzania — Software Engineer',
    'Developed backend services, maintained applications, debugged software issues.',
    '',
    'Skills',
    'Python, Java, REST APIs, Database Design, MySQL, Git, Docker',
    '',
    'Education',
    'BSc Computer Science, University of Dar es Salaam',
  ].join('\n');

  it('splits a recognisable "Skills" section into skillsOnlyTerms', () => {
    const evidence = buildCvEvidenceFromPlainText(CV_WITH_HEADERS);
    expect(evidence.skillsOnlyTerms).toEqual(
      expect.arrayContaining([
        'Python',
        'Java',
        'REST APIs',
        'Database Design',
        'MySQL',
        'Git',
        'Docker',
      ]),
    );
  });

  it('keeps the Experience/Education sections in experienceText and excludes the Skills list', () => {
    const evidence = buildCvEvidenceFromPlainText(CV_WITH_HEADERS);
    expect(evidence.experienceText).toContain('Toyota Tanzania');
    expect(evidence.experienceText).toContain('Developed backend services');
    expect(evidence.experienceText).toContain('University of Dar es Salaam');
    // "REST APIs" only ever appears under the Skills header in this fixture.
    expect(evidence.experienceText).not.toContain('REST APIs');
  });

  it('falls back to treating the whole text as experience evidence when no recognisable header exists', () => {
    const freeform =
      'Experienced backend engineer skilled in Python and REST APIs, built at Toyota.';
    const evidence = buildCvEvidenceFromPlainText(freeform);
    expect(evidence.experienceText).toBe(freeform);
    expect(evidence.skillsOnlyTerms).toEqual([]);
  });

  it('does not misclassify an ordinary sentence mentioning "skills" as a section header', () => {
    const text = [
      'Experience',
      'My skills have grown significantly over the years at Toyota.',
    ].join('\n');
    const evidence = buildCvEvidenceFromPlainText(text);
    expect(evidence.experienceText).toContain('My skills have grown significantly');
    expect(evidence.skillsOnlyTerms).toEqual([]);
  });
});
