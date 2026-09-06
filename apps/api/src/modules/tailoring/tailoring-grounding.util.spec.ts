import type { CvContent } from '@cvpilot/shared';
import { classifySuggestionGrounding } from './tailoring-grounding.util';

// Mirrors the real "Veronica regression" production CV shape: a backend
// engineer whose CV genuinely supports debugging/backend maintenance and an
// undergraduate degree with a single VIP reception mention — nothing more.
const CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Veronica Doe',
    email: 'veronica@example.com',
    jobTitle: 'Backend Engineer',
  },
  summary: 'Backend Engineer with experience developing and maintaining backend applications.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme Corp',
      title: 'Backend Engineer',
      startDate: '2022-01',
      current: true,
      bullets: [
        'Debugged software issues across backend services',
        'Maintained backend applications for production systems',
        'Assisted with a VIP reception during a company event',
      ],
    },
  ],
  education: [
    {
      id: 'ed-1',
      institution: 'University X',
      degree: 'Undergraduate degree',
      field: 'International Relations',
    },
  ],
  skills: [
    { id: 'sk-1', name: 'Python' },
    { id: 'sk-2', name: 'REST APIs' },
  ],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

function suggestion(overrides: Partial<Parameters<typeof classifySuggestionGrounding>[0]> = {}) {
  return {
    section: 'summary' as const,
    originalContent: CONTENT.summary!,
    suggestedContent: CONTENT.summary!,
    evidence: undefined,
    reason: 'Improves alignment with the job description.',
    ...overrides,
  };
}

describe('classifySuggestionGrounding()', () => {
  // ─── Summary — Case A (teamwork/intensity inflation) ───────────────────────

  it('rejects "strong background" when the CV does not support that intensity anywhere', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent:
          'Experienced Backend Engineer with a strong background in developing and maintaining backend applications.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('STRENGTHENED');
  });

  it('rejects "Proficient in application debugging and system monitoring" (strengthened + broadened)', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent: 'Proficient in application debugging and system monitoring.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
  });

  // `reason` is never applied to the CV (only suggestedContent/editedContent
  // are — see TailoringService.applyDecisions) — so when suggestedContent
  // itself is safe, an unsupported claim in `reason` alone must not discard
  // an otherwise-useful CV change. The reason is sanitized instead.
  it('keeps a suggestion with safe suggestedContent but sanitizes a reason that injects an unsupported teamwork/agile claim', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent: 'Backend Engineer focused on reliable, well-tested services.',
        reason:
          'Enhances the summary by emphasizing teamwork and aligns with collaboration within an agile team.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.sanitizedReason).toBe('Improves alignment with the job description.');
  });

  it('still rejects outright when suggestedContent itself (not just reason) injects the unsupported claim', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent: 'Backend Engineer with strong agile team leadership experience.',
        reason: 'Aligns with the job description.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
  });

  it('does not sanitize a reason that is already safe', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent: 'Backend Engineer with hands-on experience shipping production services.',
        reason: 'Improves alignment with the job description.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.sanitizedReason).toBeUndefined();
  });

  // ─── Skills — Case B (fake skill insertion) ─────────────────────────────────

  it('rejects adding "System monitoring" as a new skill with no genuine evidence', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'skills',
        originalContent: '',
        suggestedContent: 'System monitoring',
        evidence: 'Debugged software issues across backend services',
        reason: 'The job description asks for monitoring experience.',
      },
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
  });

  it('rejects adding a new skill with no evidence at all', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'skills',
        originalContent: '',
        suggestedContent: 'Kubernetes',
        evidence: undefined,
        reason: 'The role requires Kubernetes.',
      },
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
  });

  it('allows adding a new skill that is genuinely evidenced by an exact CV quote', () => {
    // Note: skill-grounding.util.ts's word-matching does not stem verb forms
    // ("debugging" vs "debugged" are treated as different words) — that is a
    // pre-existing, separately-tested limitation of isNewSkillGrounded, not
    // something this task changes, so this example intentionally uses a
    // noun phrase that appears in the same form in both places.
    const verdict = classifySuggestionGrounding(
      {
        section: 'skills',
        originalContent: '',
        suggestedContent: 'Backend Services',
        evidence: 'Debugged software issues across backend services',
        reason: 'Backend services work is explicitly demonstrated in the work history.',
      },
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  // ─── Education — Case C (Veronica regression) ───────────────────────────────

  it('rejects "International Relations graduate" when the CV only says undergraduate', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        originalContent: 'Undergraduate degree in International Relations at University X',
        suggestedContent: 'International Relations graduate of University X',
        evidence: undefined,
        reason: 'Concise phrasing for the education section.',
      },
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('BROADENED');
  });

  // ─── Experience scope — Case C (Veronica regression) ────────────────────────

  it('rejects broadening "VIP reception" into "corporate events" and "conferences"', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Assisted with a VIP reception during a company event',
        suggestedContent: 'Organized corporate events and conferences, including a VIP reception',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('BROADENED');
  });

  it('rejects broadening into "VIP functions"', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Assisted with a VIP reception during a company event',
        suggestedContent: 'Coordinated VIP functions and receptions for company events',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(false);
  });

  // ─── Positive controls ───────────────────────────────────────────────────────

  it('allows reordering the same words within a bullet', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Debugged software issues across backend services',
        suggestedContent: 'Across backend services, debugged software issues',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.level).toBe('REORDER');
  });

  it('allows a wording-only paraphrase: "debugging" -> "application debugging"', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Debugged software issues across backend services',
        suggestedContent: 'Performed application debugging across backend services',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  it('allows a wording-only paraphrase: "backend maintenance" -> "maintaining backend applications"', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Maintained backend applications for production systems',
        suggestedContent: 'Backend maintenance experience across production systems',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  it('allows shortening irrelevant content without changing its factual meaning', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        section: 'workExperience',
        originalContent: 'Assisted with a VIP reception during a company event',
        suggestedContent: 'Assisted with a VIP reception',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  it('allows surfacing/emphasizing an existing skill already present in the CV', () => {
    const verdict = classifySuggestionGrounding(
      suggestion({
        suggestedContent: 'Backend Engineer skilled in Python and REST APIs.',
      }),
      CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  it('allows an intensity term when the CV genuinely already supports it elsewhere', () => {
    const contentWithExpertise: CvContent = {
      ...CONTENT,
      workExperience: [
        {
          ...CONTENT.workExperience[0]!,
          bullets: [
            ...CONTENT.workExperience[0]!.bullets,
            'Recognized as an expert in backend reliability',
          ],
        },
      ],
    };
    const verdict = classifySuggestionGrounding(
      suggestion({ suggestedContent: 'Expert Backend Engineer focused on reliable services.' }),
      contentWithExpertise,
    );
    expect(verdict.allowed).toBe(true);
  });

  it('treats an unchanged suggestion as EXACT', () => {
    const verdict = classifySuggestionGrounding(suggestion(), CONTENT);
    expect(verdict.allowed).toBe(true);
    expect(verdict.level).toBe('EXACT');
  });
});

// ─── Cross-entry evidence scoping (multi-entry CV) ───────────────────────────
// A term evidenced in ONE work-experience/education entry must not ground a
// claim about a DIFFERENT entry — Docker in Skills (or a different job) does
// not prove it was used at Toyota; "conferences" attested for Role A does
// not prove Role B involved them.

const MULTI_ENTRY_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Veronica Doe', email: 'veronica@example.com' },
  summary: 'Backend engineer with a varied career history.',
  workExperience: [
    {
      id: 'we-toyota',
      company: 'Toyota',
      title: 'Backend Engineer',
      startDate: '2022-01',
      current: true,
      bullets: ['Maintained backend applications'],
    },
    {
      id: 'we-role-a',
      company: 'Role A Co',
      title: 'Event Coordinator',
      startDate: '2019-01',
      endDate: '2020-01',
      current: false,
      bullets: ['Supported conferences for enterprise clients'],
    },
    {
      id: 'we-role-b',
      company: 'Role B Co',
      title: 'Assistant',
      startDate: '2021-01',
      current: true,
      bullets: ['Handled VIP reception during launch events'],
    },
  ],
  education: [
    {
      id: 'ed-a',
      institution: 'University A',
      degree: 'Graduate degree',
      field: 'Business Administration',
    },
    {
      id: 'ed-b',
      institution: 'University B',
      degree: 'Undergraduate degree',
      field: 'International Relations',
    },
  ],
  skills: [{ id: 'sk-1', name: 'Docker' }],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

describe('classifySuggestionGrounding() — cross-entry evidence scoping', () => {
  // (A) Docker exists in Skills only; the Toyota role never mentions it.
  it('(A) rejects attributing a Skills-only technology to a work entry that never mentions it', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota | Backend Engineer',
        originalContent: 'Maintained backend applications',
        suggestedContent: 'Maintained Docker-based backend applications',
        reason: 'Aligns with the containerization requirement in the job description.',
      },
      MULTI_ENTRY_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('BROADENED');
  });

  // (B) Same work entry's OWN bullet already mentions Docker — retaining it
  // in a reworded bullet for that SAME entry is genuinely grounded.
  it('(B) allows retaining a technology the SAME work entry already mentions', () => {
    const contentWithDockerAtToyota: CvContent = {
      ...MULTI_ENTRY_CONTENT,
      workExperience: [
        {
          ...MULTI_ENTRY_CONTENT.workExperience[0]!,
          bullets: ['Maintained Docker-based backend applications'],
        },
        ...MULTI_ENTRY_CONTENT.workExperience.slice(1),
      ],
    };
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota | Backend Engineer',
        originalContent: 'Maintained Docker-based backend applications',
        suggestedContent: 'Maintained backend applications using Docker containers',
        reason: 'Improves wording clarity.',
      },
      contentWithDockerAtToyota,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (C) "Conferences" is attested for Role A only; Role B's suggestion must
  // not inherit it.
  it('(C) rejects a term attested only in a DIFFERENT work-experience entry (Role A -> Role B)', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Role B Co | Assistant',
        originalContent: 'Handled VIP reception during launch events',
        suggestedContent: 'Handled VIP reception and conferences during launch events',
        reason: 'Broadens relevant experience for the role.',
      },
      MULTI_ENTRY_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('BROADENED');
  });

  // (D) Role B itself genuinely mentions conferences elsewhere in its OWN
  // bullets — a reword drawing on that is safe.
  it('(D) allows a term when the RELEVANT entry itself already mentions it', () => {
    const contentWithConferencesAtRoleB: CvContent = {
      ...MULTI_ENTRY_CONTENT,
      workExperience: [
        ...MULTI_ENTRY_CONTENT.workExperience.slice(0, 2),
        {
          ...MULTI_ENTRY_CONTENT.workExperience[2]!,
          bullets: [
            'Handled VIP reception during launch events',
            'Supported conferences for select clients',
          ],
        },
      ],
    };
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Role B Co | Assistant',
        originalContent: 'Handled VIP reception during launch events',
        suggestedContent: 'Managed VIP reception and conferences for launch events',
        reason: 'Improves wording clarity.',
      },
      contentWithConferencesAtRoleB,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (E) One education entry already uses "graduate" wording; a DIFFERENT
  // (undergraduate) entry must not inherit that status.
  it('(E) rejects upgrading one education entry using wording only a DIFFERENT education entry supports', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University B | Undergraduate degree',
        originalContent: 'Undergraduate degree in International Relations at University B',
        suggestedContent: 'Graduate degree in International Relations at University B',
        reason: 'Clarifies academic status.',
      },
      MULTI_ENTRY_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    // V2.2: this now trips the more specific IDENTITY_CHANGED check first
    // (the degree field itself — "Undergraduate degree" — was swapped for
    // a different one), rather than the generic BROADENED term check.
    // Either way the suggestion is still correctly rejected.
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  it('falls back to originalContent-only scoping (never the whole CV) when the entry cannot be identified', () => {
    // No `field`, and originalContent matches no bullet in any entry — the
    // suggestion cannot be reliably attributed to a specific job, so it must
    // not benefit from Docker being evidenced elsewhere in the CV.
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        originalContent: 'Some bullet text not present verbatim in the CV',
        suggestedContent: 'Some bullet text mentioning Docker not present verbatim in the CV',
        reason: 'Improves relevance.',
      },
      MULTI_ENTRY_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('BROADENED');
  });
});

// ─── V2.2 — factual identity field protection (production regression) ───────
// Production QA: an AI "Company | Job Title" suggestion silently renamed
// "Junior Developer" to "Backend Developer" to better match the target job
// description. Root cause: no curated term list can catch an arbitrary
// job-title swap the way it catches "conferences" or "Docker" — job titles
// aren't a fixed vocabulary, so the suggestion fell through every existing
// check straight to PARAPHRASE (allowed). Reproduces the exact production
// CV shape (Toyota Tanzania, Junior Developer, 2024-11 – 2025-09).

const TOYOTA_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Production QA', email: 'qa@example.com' },
  summary:
    'Experienced Backend Engineer with a background in developing and maintaining backend ' +
    'applications. Skilled in application debugging and system monitoring.',
  workExperience: [
    {
      id: 'we-toyota-prod',
      company: 'Toyota Tanzania',
      title: 'Junior Developer',
      location: 'Dar es Salaam',
      startDate: '2024-11',
      endDate: '2025-09',
      current: false,
      bullets: ['Debugged software issues', 'Maintained backend applications'],
    },
  ],
  education: [
    {
      id: 'ed-prod',
      institution: 'University Y',
      degree: 'Bachelor of Science (In Progress)',
      field: 'Computer Science',
    },
  ],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

const IDENTITY_LINE = 'Junior Developer at Toyota Tanzania (Dar es Salaam) [2024-11 – 2025-09]';

describe('classifySuggestionGrounding() — factual identity field protection', () => {
  // (1) The exact production regression: job title silently rewritten to
  // align with the target job description.
  it('(1) rejects an AI suggestion that renames the job title', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota Tanzania | Junior Developer',
        originalContent: IDENTITY_LINE,
        suggestedContent:
          'Backend Developer at Toyota Tanzania (Dar es Salaam) [2024-11 – 2025-09]',
        reason:
          'Aligns the job title with the backend focus, which is more relevant to the target job.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (2) Harmless formatting/punctuation normalization — the title, company,
  // and dates are all still genuinely present, just reformatted.
  it('(2) allows harmless whitespace/punctuation normalization that preserves the same title, company, and dates', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota Tanzania | Junior Developer',
        originalContent: IDENTITY_LINE,
        suggestedContent: 'Junior Developer, Toyota Tanzania (Dar es Salaam), 2024-11 to 2025-09',
        reason: 'Improves formatting consistency.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (3) Company identity changed.
  it('(3) rejects an AI suggestion that changes the company name', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota Tanzania | Junior Developer',
        originalContent: IDENTITY_LINE,
        suggestedContent:
          'Junior Developer at Toyota Motor Corporation (Dar es Salaam) [2024-11 – 2025-09]',
        reason: 'Uses the full corporate name.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (4) Employment dates changed.
  it('(4) rejects an AI suggestion that changes the employment start date', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota Tanzania | Junior Developer',
        originalContent: IDENTITY_LINE,
        suggestedContent: 'Junior Developer at Toyota Tanzania (Dar es Salaam) [2023-11 – 2025-09]',
        reason: 'Corrects the start date.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (5) Education qualification status changed within the SAME entry
  // (distinct from the cross-entry "graduate" test above — this is the
  // same entry's own degree field being upgraded from in-progress to
  // completed).
  it('(5) rejects an AI suggestion that upgrades an in-progress degree to completed', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University Y | Bachelor of Science (In Progress)',
        originalContent: 'Bachelor of Science (In Progress) in Computer Science at University Y',
        suggestedContent: 'Bachelor of Science (Completed) in Computer Science at University Y',
        reason: 'Reflects near-completion of the degree.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (6) Safe bullet rewording — demonstrated work, not identity, so it must
  // still be allowed.
  it('(6) allows rewording a demonstrated-work bullet without touching identity fields', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Toyota Tanzania | Junior Developer',
        originalContent: 'Debugged software issues',
        suggestedContent: 'Performed application debugging',
        reason: 'Uses more specific terminology from the job description.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (7) The actual "system monitoring" production case — see the module's
  // git history / PR description for the full investigation. "System
  // monitoring" is ALREADY part of TOYOTA_CONTENT.summary (the CURRENT/
  // pre-existing text, exactly as production QA reported it) — this is not
  // new AI fabrication, so a suggestion that reworks the surrounding
  // wording while preserving that pre-existing phrase must be allowed. The
  // sibling test "rejects '...system monitoring' (strengthened + broadened)"
  // earlier in this file proves the inverse still holds: introducing
  // "system monitoring" into a CV that never had it is still rejected.
  it('(7) allows a summary reword that preserves a pre-existing phrase from the CURRENT summary ("system monitoring")', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'summary',
        originalContent: TOYOTA_CONTENT.summary!,
        suggestedContent:
          'Backend Engineer with experience in developing and maintaining backend applications. ' +
          'Skilled in debugging software applications and system monitoring.',
        reason: 'Improves clarity.',
      },
      TOYOTA_CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });
});

// ─── V2.3 — exact normalized identity comparison (production regression) ────
// V2.2's identityFieldsPreserved used whole-phrase SUBSTRING containment,
// which incorrectly PASSED a short old identity value that is still a whole
// word inside a longer, expanded new value (e.g. "Engineer" is still found
// inside "Senior Backend Engineer"). These tests reproduce that exact class
// of bug and confirm the fix: the value extracted from the SAME slot in
// suggestedContent (per the known composite-line schema) must be exactly
// equal to the entry's real value, not merely contain/be-contained.

const ENGINEER_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Production QA 2', email: 'qa2@example.com' },
  summary: 'Engineer with backend experience.',
  workExperience: [
    {
      id: 'we-eng',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      current: true,
      bullets: ['Built backend services'],
    },
  ],
  education: [
    {
      id: 'ed-eng',
      institution: 'University Z',
      degree: 'Bachelor',
      field: 'Computer Science',
    },
  ],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

const ENGINEER_IDENTITY_LINE = 'Engineer at Acme [2022-01 – Present]';
const BACHELOR_IDENTITY_LINE = 'Bachelor in Computer Science at University Z';

describe('classifySuggestionGrounding() — V2.3 exact normalized identity comparison', () => {
  // (1) The flagship bug: a short title is a whole-word SUFFIX of the
  // expanded new title, so the old V2.2 substring check incorrectly passed
  // this. Must now be rejected.
  it('(1) rejects expanding "Engineer" into "Senior Backend Engineer" (old title is a substring of the new one)', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Acme | Engineer',
        originalContent: ENGINEER_IDENTITY_LINE,
        suggestedContent: 'Senior Backend Engineer at Acme [2022-01 – Present]',
        reason: 'Aligns seniority with the target role.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (2) Same bug, company side: "Acme" is a whole-word PREFIX of the
  // expanded new company name.
  it('(2) rejects expanding "Acme" into "Acme Corporation International" (old company is a substring of the new one)', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Acme | Engineer',
        originalContent: ENGINEER_IDENTITY_LINE,
        suggestedContent: 'Engineer at Acme Corporation International [2022-01 – Present]',
        reason: 'Uses the full corporate name.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (3) A genuinely harmless reformatting of the SAME identity line (dashes
  // -> commas/"to") must still be allowed — the fix must not become
  // over-eager and reject safe rewording that changes no identity value.
  it('(3) allows reformatting the work identity line into comma-separated style with the same title/company/dates', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Acme | Engineer',
        originalContent: ENGINEER_IDENTITY_LINE,
        suggestedContent: 'Engineer, Acme, 2022-01 to Present',
        reason: 'Improves formatting consistency.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (4) Employment dates: a genuine identity change (start date moved
  // earlier) must still be rejected under the new comparison strategy too.
  it('(4) rejects changing the employment start date even when title and company are reformatted safely', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Acme | Engineer',
        originalContent: ENGINEER_IDENTITY_LINE,
        suggestedContent: 'Engineer, Acme, 2020-01 to Present',
        reason: 'Corrects the start date.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (5) Education degree expansion: "Bachelor" is a whole-word PREFIX of
  // "Bachelor with Honours" — same class of bug as (1)/(2), education side.
  it('(5) rejects expanding "Bachelor" into "Bachelor with Honours" (old degree is a substring of the new one)', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University Z | Bachelor',
        originalContent: BACHELOR_IDENTITY_LINE,
        suggestedContent: 'Bachelor with Honours in Computer Science at University Z',
        reason: 'Reflects the honours classification.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (6) Education institution expansion: "University Z" is a whole-word
  // PREFIX of the expanded new institution name.
  it('(6) rejects expanding "University Z" into "University Z International Campus"', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University Z | Bachelor',
        originalContent: BACHELOR_IDENTITY_LINE,
        suggestedContent: 'Bachelor in Computer Science at University Z International Campus',
        reason: 'Uses the full campus name.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (7) Education field-of-study expansion: "Computer Science" is a
  // whole-word SUFFIX of "Advanced Computer Science" — this is the field
  // (entry.field) protection that V2.2 never even checked at all.
  it('(7) rejects expanding "Computer Science" into "Advanced Computer Science" (field of study)', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University Z | Bachelor',
        originalContent: BACHELOR_IDENTITY_LINE,
        suggestedContent: 'Bachelor in Advanced Computer Science at University Z',
        reason: 'Uses more specific terminology from the job description.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });

  // (8) A genuinely harmless reformatting of the SAME education identity
  // line must still be allowed.
  it('(8) allows reformatting the education identity line while preserving the same degree/field/institution', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'education',
        field: 'University Z | Bachelor',
        originalContent: BACHELOR_IDENTITY_LINE,
        suggestedContent: 'Bachelor in Computer Science, University Z',
        reason: 'Improves formatting consistency.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(true);
  });

  // (9) A suggestion whose suggestedContent no longer has a recognizable
  // composite title/company structure at all (while the field genuinely
  // applies) must fail closed rather than fall back to a permissive check.
  it('(9) rejects when the new content no longer has a recognizable title/company structure at all', () => {
    const verdict = classifySuggestionGrounding(
      {
        section: 'workExperience',
        field: 'Acme | Engineer',
        originalContent: ENGINEER_IDENTITY_LINE,
        suggestedContent: 'Senior Backend Engineer',
        reason: 'Simplifies the entry.',
      },
      ENGINEER_CONTENT,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.level).toBe('IDENTITY_CHANGED');
  });
});
