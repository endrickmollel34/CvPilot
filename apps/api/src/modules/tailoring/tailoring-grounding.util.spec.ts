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
    expect(verdict.level).toBe('BROADENED');
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
