import type { CvEvidence } from './cv-evidence.util';
import {
  findUnsupportedPossessionClaims,
  extractJobDescriptionTerms,
  computeUnestablishedJdTerms,
} from './possession-claim-guard.util';

describe('extractJobDescriptionTerms() (RABBIT_NOTEBOOK.md §55)', () => {
  it('extracts a dotted framework name', () => {
    expect(extractJobDescriptionTerms('Experience with Node.js and Next.js.')).toEqual(
      expect.arrayContaining(['node.js', 'next.js']),
    );
  });

  it('extracts a mixed-internal-capital compound name', () => {
    const terms = extractJobDescriptionTerms('Design and query PostgreSQL and GraphQL APIs.');
    expect(terms).toEqual(expect.arrayContaining(['postgresql', 'graphql']));
  });

  it('extracts a short all-caps acronym', () => {
    const terms = extractJobDescriptionTerms('Working knowledge of SQL and AWS.');
    expect(terms).toEqual(expect.arrayContaining(['sql', 'aws']));
  });

  // §56: ordinary-cased common framework names (react, node, html, css, ...)
  // moved OUT of this function's own responsibility into the permanent,
  // always-checked ALL_CHECKED_TERMS list (see findUnsupportedPossessionClaims's
  // own describe block below for coverage of that) — this function now only
  // covers shapes that genuinely need the job description's own text.

  it('does not extract ordinary sentence words', () => {
    const terms = extractJobDescriptionTerms(
      'We are looking for a driven and collaborative engineer.',
    );
    expect(terms).not.toContain('we');
    expect(terms).not.toContain('driven');
    expect(terms).not.toContain('collaborative');
  });
});

// ─── §57: computeUnestablishedJdTerms() — proactive, pre-generation guidance ─
//
// Drives buildProactiveGuidance() in cover-letter-ai.service.ts. Must only
// list terms that (a) the job description actually asks for and (b) the
// candidate evidence does not establish — an earlier draft filtered the
// entire ~70-entry ALL_CHECKED_TERMS list down to "absent from evidence",
// which produced a long, mostly-irrelevant list for jobs that never
// mentioned most of those terms. Caught in design review, not by a test.
describe('computeUnestablishedJdTerms() (RABBIT_NOTEBOOK.md §57)', () => {
  it('lists only terms the job description actually names, not the whole checked-term catalog', () => {
    const terms = computeUnestablishedJdTerms('We need a backend engineer skilled in Kubernetes.', {
      experienceText: '',
      skillsOnlyTerms: [],
    });
    expect(terms).toContain('kubernetes');
    // "agile", "docker", etc. are on ALL_CHECKED_TERMS but never mentioned
    // in this job description — they must not appear in the guidance list.
    expect(terms).not.toContain('agile');
    expect(terms).not.toContain('docker');
  });

  it('excludes a job-description term the candidate evidence already establishes', () => {
    const terms = computeUnestablishedJdTerms(
      'We need a backend engineer skilled in Python and Kubernetes.',
      { experienceText: 'Built services in Python for three years.', skillsOnlyTerms: [] },
    );
    expect(terms).not.toContain('python');
    expect(terms).toContain('kubernetes');
  });

  it('returns an empty list when the job description names nothing the candidate lacks', () => {
    const terms = computeUnestablishedJdTerms('We need a backend engineer skilled in Python.', {
      experienceText: 'Built services in Python for three years.',
      skillsOnlyTerms: [],
    });
    expect(terms).toEqual([]);
  });

  it('a bare skills-list entry is sufficient to establish a job-description term', () => {
    const terms = computeUnestablishedJdTerms('We need a backend engineer skilled in Docker.', {
      experienceText: '',
      skillsOnlyTerms: ['Docker'],
    });
    expect(terms).not.toContain('docker');
  });
});

const CV_TEXT =
  'Software engineer with 3 years of experience building web applications in TypeScript ' +
  'and JavaScript. Strong communicator with a BSc in Computer Science.';

// Matches the pre-V2 test fixture shape: everything as one flat evidence
// blob, no skills-only tier — preserves the original test intent exactly.
const FLAT_EVIDENCE: CvEvidence = { experienceText: CV_TEXT, skillsOnlyTerms: [] };

describe('findUnsupportedPossessionClaims()', () => {
  // ─── The exact "BAD" examples from manual regression testing ────────────────

  it('flags "I am proficient in Python."', () => {
    const violations = findUnsupportedPossessionClaims('I am proficient in Python.', FLAT_EVIDENCE);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags "I have strong REST API experience."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I have strong REST API experience.',
      FLAT_EVIDENCE,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags "I am well-versed in Git and Docker."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am well-versed in Git and Docker.',
      FLAT_EVIDENCE,
    );
    // Both Git and Docker are unsupported — expect a violation for each.
    expect(violations.length).toBe(2);
  });

  it('flags "I have experience optimizing PostgreSQL/MySQL queries."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I have experience optimizing PostgreSQL/MySQL queries.',
      FLAT_EVIDENCE,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  // ─── The exact "GOOD" aspirational examples — must never be flagged ────────

  it('does not flag "I am interested in expanding my Docker knowledge."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am interested in expanding my Docker knowledge.',
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  it('does not flag "I am eager to develop further experience with cloud platforms."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am eager to develop further experience with cloud platforms.',
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  // ─── Supported skills must never be flagged ────────────────────────────────

  it('does not flag a possession claim about a skill genuinely present in the CV', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am proficient in TypeScript and JavaScript.',
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  it('does not flag ordinary CV-grounded prose with no possession-pattern phrasing', () => {
    const violations = findUnsupportedPossessionClaims(
      'My three years building web applications make me well-suited for this role.',
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  // ─── Negation / disclaimer framing must never be flagged ───────────────────

  it('does not flag a sentence that explicitly disclaims the technology', () => {
    const violations = findUnsupportedPossessionClaims(
      "While I haven't directly used Docker, I have strong experience with similar tooling.",
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  // ─── Ambiguous phrasing (no clear possession pattern) is left unflagged ────

  it('does not flag a bare mention with no possession-pattern verb', () => {
    const violations = findUnsupportedPossessionClaims(
      'The team uses Docker extensively for deployments.',
      FLAT_EVIDENCE,
    );
    expect(violations).toEqual([]);
  });

  // ─── V2: evidence-tier distinction (Cover Letter Quality V2) ───────────────
  // production QA finding: "REST APIs" listed only as a skill got inflated
  // into "I developed scalable REST APIs at Toyota" — an unearned
  // experience-level claim a skills-list entry alone must never satisfy.

  const SKILL_ONLY_EVIDENCE: CvEvidence = {
    experienceText:
      'Toyota Tanzania — Software Engineer. Developed backend services, maintained applications, ' +
      'debugged software issues.',
    skillsOnlyTerms: ['Python', 'Java', 'REST APIs', 'Database Design', 'MySQL', 'Git', 'Docker'],
  };

  describe('A/B — listed skill only vs demonstrated experience', () => {
    it('(A) flags an experience-level claim about a skill that is only ever listed, never demonstrated', () => {
      const violations = findUnsupportedPossessionClaims(
        'This role prepared me well for developing scalable REST APIs.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('rest api'))).toBe(true);
    });

    it('(A) flags "I developed REST APIs at Toyota" — a skills-list entry cannot ground a work-history claim', () => {
      const violations = findUnsupportedPossessionClaims(
        'I developed REST APIs at Toyota.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('rest api'))).toBe(true);
    });

    it('(B) does not flag a modest knowledge claim about a listed-only skill', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have knowledge of REST APIs and Database Design.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('(B) does not flag "my listed skills include Docker"', () => {
      const violations = findUnsupportedPossessionClaims(
        'My listed skills include Docker and Git.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('does not flag an experience-level claim about a term that genuinely appears in a work bullet', () => {
      const violations = findUnsupportedPossessionClaims(
        'I developed backend services and debugged software issues at Toyota.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });
  });

  describe('C — missing JD requirement (not present anywhere on the CV)', () => {
    it('flags an unconditional experience claim about a technology absent from the whole CV', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have hands-on Kubernetes experience.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('kubernetes'))).toBe(true);
    });

    it('does not flag a growth-interest framing for a missing technology', () => {
      const violations = findUnsupportedPossessionClaims(
        'I would welcome the opportunity to grow my CI/CD skills in this role.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });
  });

  describe('D — soft-skill inflation from unrelated technical work', () => {
    it('flags an experience-level agile/teamwork claim when nothing in the CV mentions it', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have experience working in agile teams.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('agile'))).toBe(true);
    });

    it('flags "strong attention to detail" inferred purely from debugging work', () => {
      const violations = findUnsupportedPossessionClaims(
        'Debugging software at Toyota gave me strong attention to detail.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('attention to detail'))).toBe(true);
    });

    it('flags an unsupported problem-solving claim', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have excellent problem-solving skills.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('problem-solving'))).toBe(true);
    });

    it('does not flag a soft-skill claim when the CV genuinely states it', () => {
      const evidenceWithTeamwork: CvEvidence = {
        experienceText: `${SKILL_ONLY_EVIDENCE.experienceText} Collaborated closely with cross-functional teams using agile methodology.`,
        skillsOnlyTerms: SKILL_ONLY_EVIDENCE.skillsOnlyTerms,
      };
      const violations = findUnsupportedPossessionClaims(
        'I have experience working in agile teams.',
        evidenceWithTeamwork,
      );
      expect(violations).toEqual([]);
    });

    // Reliability fix (see the module report): a soft skill has no meaningful
    // "used on the job" vs. "merely listed" split the way a technology does,
    // so an EXPERIENCE-tier soft-skill claim is now satisfied by the skill
    // simply being named ANYWHERE in the CV — including a structured CV's
    // own skills entry — not experienceText specifically. Hard
    // technologies/capability-claim strictness (see the "day one" test
    // above) are completely unaffected by this change.
    it('does not flag an experience-level soft-skill claim when the skill is listed as a skills-only entry (fix)', () => {
      const evidenceWithSoftSkillListed: CvEvidence = {
        experienceText: SKILL_ONLY_EVIDENCE.experienceText,
        skillsOnlyTerms: [...SKILL_ONLY_EVIDENCE.skillsOnlyTerms, 'Problem-solving'],
      };
      const violations = findUnsupportedPossessionClaims(
        'I have extensive problem-solving experience from my academic and professional work.',
        evidenceWithSoftSkillListed,
      );
      expect(violations).toEqual([]);
    });

    it('still flags the same experience-level soft-skill claim when it is not listed anywhere at all', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have extensive problem-solving experience from my academic and professional work.',
        SKILL_ONLY_EVIDENCE, // no soft skills listed in either tier
      );
      expect(violations.some((v) => v.includes('problem-solving'))).toBe(true);
    });
  });

  // ─── V2.1 — unsupported FUTURE CAPABILITY claims ───────────────────────────
  // Production QA finding: the model stopped claiming unsupported PAST
  // experience but started implying unsupported FUTURE capability instead —
  // "I can contribute to implementing X" — and the old aspirational override
  // ("eager to," "interested in") exempted the whole sentence even when a
  // capability claim followed later in it.

  describe('V2.1 — future-capability claims', () => {
    // (1) JD-only authentication + capability claim → rejected.
    it('flags "I can contribute to implementing authentication" when authentication is JD-only', () => {
      const violations = findUnsupportedPossessionClaims(
        'I can contribute to implementing secure authentication systems.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('authentication'))).toBe(true);
    });

    // The exact production QA sentence — an aspirational opener ("eager to")
    // must not exempt the capability claim ("implementing ...") that follows.
    it('flags the exact production QA sentence despite its aspirational opener', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am also eager to leverage my database design and MySQL knowledge to contribute to ' +
          'optimizing database queries and implementing secure authentication systems.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('authentication'))).toBe(true);
    });

    // V2.1.1 note: under whole-sentence classification (V2.1) this was
    // flagged because ANY capability match anywhere in the sentence
    // promoted every term in it. Under the more precise per-term model
    // (V2.1.1), "authentication" here is directly governed by "interested
    // in exploring" (the nearest preceding claim pattern) — a genuinely
    // safe framing — while "I can contribute and grow" refers BACK to
    // "authentication systems and database design" only by anaphora
    // ("areas where..."), which a deterministic, non-NLP positional
    // association cannot resolve. This is an accepted, documented trade-off
    // (see the module header comment for V2.1.1): the alternative — reverting
    // to whole-sentence classification — is what caused the production
    // availability regression this fix addresses. The concrete unsafe
    // patterns from the task spec (a capability verb naming its object
    // directly, e.g. "I can contribute to implementing X") remain caught —
    // see the tests below.
    it('does not flag anaphoric capability language that never re-names the unsupported term ("...where I know I can contribute")', () => {
      const violations = findUnsupportedPossessionClaims(
        "I'm particularly interested in exploring authentication systems and database design " +
          'further, areas where I know I can contribute and grow.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('flags other equivalent capability phrasings ("ready to implement", "can help build")', () => {
      expect(
        findUnsupportedPossessionClaims(
          'I am ready to implement authentication for your platform.',
          SKILL_ONLY_EVIDENCE,
        ).some((v) => v.includes('authentication')),
      ).toBe(true);

      expect(
        findUnsupportedPossessionClaims(
          'I can help build out your authentication systems.',
          SKILL_ONLY_EVIDENCE,
        ).some((v) => v.includes('authentication')),
      ).toBe(true);
    });

    // (2) JD-only authentication + genuine learning-interest framing (no
    // capability claim) → allowed.
    it('does not flag "I am interested in learning authentication" — genuine learning interest, no capability claim', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am interested in learning authentication and growing my skills in this area.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('does not flag any of the SAFE growth-language examples for a JD-only requirement', () => {
      const safeSentences = [
        'I am interested in learning Kubernetes.',
        'I would welcome the opportunity to develop my knowledge of Kubernetes.',
        'I am keen to gain experience with Kubernetes.',
        'I am interested in exploring Kubernetes further.',
        'I would like to strengthen my skills in Kubernetes.',
      ];
      for (const sentence of safeSentences) {
        expect(findUnsupportedPossessionClaims(sentence, SKILL_ONLY_EVIDENCE)).toEqual([]);
      }
    });

    // (3) CV explicitly demonstrates the requirement + contribution claim →
    // allowed, per the task's explicit carve-out.
    it('allows a capability claim when the CV explicitly demonstrates the requirement', () => {
      const evidenceWithAuth: CvEvidence = {
        experienceText: `${SKILL_ONLY_EVIDENCE.experienceText} Implemented authentication using OAuth.`,
        skillsOnlyTerms: SKILL_ONLY_EVIDENCE.skillsOnlyTerms,
      };
      const violations = findUnsupportedPossessionClaims(
        'I can contribute to implementing secure authentication systems.',
        evidenceWithAuth,
      );
      expect(violations).toEqual([]);
    });

    // (4) Skill-only evidence must not become unsupported implementation
    // capability, even for a term that genuinely IS listed as a skill —
    // "database design" is a real skills-list entry, but a capability claim
    // about it still requires work-history evidence, not just the skill tag.
    it('flags a capability claim about a skills-list-only term, not just terms absent from the whole CV', () => {
      const violations = findUnsupportedPossessionClaims(
        'I can deliver database design improvements from day one.',
        SKILL_ONLY_EVIDENCE, // "database design" is skills-only, never in a work bullet
      );
      expect(violations.some((v) => v.includes('database design'))).toBe(true);
    });

    it('still allows a modest knowledge claim about the same skills-list-only term', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have knowledge of database design.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    // Negation must still win unconditionally even when an experience claim
    // follows in the same sentence (unaffected by the V2.1 override split).
    it('still allows an explicit disclaimer even when experience language follows', () => {
      const violations = findUnsupportedPossessionClaims(
        "While I haven't directly built authentication systems, I have strong experience with similar security concepts.",
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });
  });

  // ─── V2.1.1 — claim-to-term granularity (production availability fix) ─────
  // Root cause: V2.1's classification was whole-sentence — one experience
  // match anywhere in a sentence required EVERY checked term in that same
  // sentence to be experience-grounded, even genuinely separate, honestly
  // phrased knowledge-only mentions. This rejected valid letters until all
  // retries were exhausted, making Cover Letter generation unavailable.

  describe('V2.1.1 — claim-to-term granularity', () => {
    // (H) The exact production-failure sentence: a multi-skill knowledge
    // statement that happens to end in an unrelated "strong foundation"
    // phrase — this alone was enough to reject the letter under V2.1.
    it('(H) accepts the exact production multi-skill knowledge sentence when all terms are skills-only', () => {
      const violations = findUnsupportedPossessionClaims(
        'My familiarity with Python, Java, and REST APIs, along with my knowledge of database ' +
          'design and MySQL, provides a strong foundation for tackling the responsibilities of ' +
          'this role.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    // (A) A simpler variant of the same pattern.
    it('(A) accepts a plain skills-only knowledge statement naming multiple terms', () => {
      expect(
        findUnsupportedPossessionClaims('My skills include Python and Java.', SKILL_ONLY_EVIDENCE),
      ).toEqual([]);
      expect(
        findUnsupportedPossessionClaims('I am familiar with Python.', SKILL_ONLY_EVIDENCE),
      ).toEqual([]);
      expect(
        findUnsupportedPossessionClaims('I have knowledge of Python.', SKILL_ONLY_EVIDENCE),
      ).toEqual([]);
    });

    it('a trailing unrelated "strong foundation" clause does not retroactively promote earlier knowledge-only terms', () => {
      const violations = findUnsupportedPossessionClaims(
        'My knowledge of Docker provides a strong foundation for this role.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    // (D) Mixed sentence, no clause-boundary punctuation at all between the
    // legitimate knowledge claim and the unsupported capability claim — the
    // hardest case, since there is no comma to lean on.
    it('(D) rejects only the unsupported capability term in a fused, unpunctuated mixed sentence', () => {
      const violations = findUnsupportedPossessionClaims(
        'My knowledge of MySQL means I can implement authentication.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('authentication'))).toBe(true);
      expect(violations.some((v) => v.includes('mysql'))).toBe(false);
    });

    it('(D) rejects only the unsupported capability term when a "strong foundation" phrase sits between the two claims', () => {
      const violations = findUnsupportedPossessionClaims(
        'My knowledge of MySQL gives me a strong foundation, and I can contribute to ' +
          'implementing secure authentication systems.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('authentication'))).toBe(true);
      expect(violations.some((v) => v.includes('mysql'))).toBe(false);
    });

    it('does not reinterpret Python/Java as professional experience merely because the sentence discusses future contribution generally', () => {
      const violations = findUnsupportedPossessionClaims(
        'My familiarity with Python and Java provides a foundation for tackling this role.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });
  });

  // ─── V3 (RABBIT_NOTEBOOK.md §55): job-description-derived checked terms ────
  // Confirmed against a real production cover letter: "I am also familiar
  // with React and Node.js" was never caught because neither term was on
  // the fixed KNOWN_TECH_TERMS list — both are explicit job-description
  // requirements, not anything genuinely on the CV. See
  // extractJobDescriptionTerms's own doc comment for the general (not a
  // React/Node.js-specific patch) fix.
  describe('V3 — job-description-derived checked terms', () => {
    // A real, unmodified excerpt of the actual job description involved in
    // the production report — reused here as synthetic test input (no real
    // candidate data), not because this specific wording is special.
    const JOB_DESCRIPTION =
      'Develop responsive user interfaces using React, HTML and CSS. ' +
      'Build and maintain REST APIs using Node.js and TypeScript. ' +
      'Design and query PostgreSQL databases.';

    it('flags a technology present ONLY in the job description, absent from the whole CV, when claimed as possessed', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am also familiar with React and Node.js.',
        SKILL_ONLY_EVIDENCE,
        JOB_DESCRIPTION,
      );
      expect(violations.some((v) => v.includes('react'))).toBe(true);
      expect(violations.some((v) => v.includes('node'))).toBe(true);
    });

    it('does not flag the same job-description technology when the CV genuinely supports it', () => {
      const evidenceWithReact: CvEvidence = {
        ...SKILL_ONLY_EVIDENCE,
        skillsOnlyTerms: [...SKILL_ONLY_EVIDENCE.skillsOnlyTerms, 'React'],
      };
      const violations = findUnsupportedPossessionClaims(
        'I am familiar with React.',
        evidenceWithReact,
        JOB_DESCRIPTION,
      );
      expect(violations).toEqual([]);
    });

    it('does not flag honest learning-intent wording about a job-description-only technology', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am eager to learn React and Node.js, which are integral to this role.',
        SKILL_ONLY_EVIDENCE,
        JOB_DESCRIPTION,
      );
      expect(violations).toEqual([]);
    });

    it('still does not flag a genuinely CV-supported claim when a job description is supplied', () => {
      const violations = findUnsupportedPossessionClaims(
        'My familiarity with Python, as highlighted in my skill set, positions me well.',
        SKILL_ONLY_EVIDENCE,
        JOB_DESCRIPTION,
      );
      expect(violations).toEqual([]);
    });

    // Updated in §56: "react"/"node" moved from being conditionally added
    // only when a job description was supplied to the permanent, always-
    // checked list (see ALL_CHECKED_TERMS's own comment) — there is no
    // principled reason a common technology should go unguarded just
    // because no job description happened to be passed. This still proves
    // the JD-specific SYNTACTIC extraction mechanism (dotted/mixed-case/
    // acronym) is additive on top of that permanent baseline, not a
    // replacement for it: dropping the job description argument entirely
    // does not weaken coverage for these already-common names.
    it('still flags common framework names even when no job description is supplied at all', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am also familiar with React and Node.',
        SKILL_ONLY_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('react'))).toBe(true);
      expect(violations.some((v) => v.includes('node'))).toBe(true);
    });
  });

  // ─── V4 (RABBIT_NOTEBOOK.md §56): a second production letter, generated
  // AFTER the §55 fix deployed, still claimed two unsupported technologies —
  // "understanding of" was never a recognised claim pattern at all, and
  // "further develop MY skills in X" was fully exempted by the same
  // aspirational-growth pattern that correctly protects genuine learning
  // wording like "develop further experience with X". Both are fixed here.
  describe('V4 — "understanding of" claims and implied-existing-skill phrasing', () => {
    // The CV genuinely supports only generic database WORK, never SQL or
    // relational databases by name — reproduces this task's own explicit
    // "generic database experience must not substantiate a specific
    // technology automatically" requirement.
    const DATABASE_WORK_EVIDENCE: CvEvidence = {
      experienceText:
        'IT Officer Intern at Toyota Tanzania. Managed internal databases and kept accurate ' +
        'logs of system incidents.',
      skillsOnlyTerms: ['HTML', 'CSS', 'Java', 'Python'],
    };

    it('flags the exact real "foundational understanding of SQL" sentence', () => {
      const violations = findUnsupportedPossessionClaims(
        'I believe my foundational understanding of SQL and relational databases, combined ' +
          'with my willingness to learn and grow, makes me a suitable candidate for this role.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('sql'))).toBe(true);
      expect(violations.some((v) => v.includes('relational database'))).toBe(true);
    });

    it('flags the exact real "further develop my skills in JavaScript and React" sentence', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am eager to apply my technical knowledge in a practical setting and to further ' +
          'develop my skills in JavaScript and React, which are integral to the ' +
          'responsibilities at Kilima Digital.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('javascript'))).toBe(true);
      expect(violations.some((v) => v.includes('react'))).toBe(true);
    });

    it('does not flag "understanding of X" when the CV genuinely supports X', () => {
      const violations = findUnsupportedPossessionClaims(
        'My understanding of Python is a strong foundation for this role.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('does not flag plain "develop my skills in X" (no "further") — genuine learning intent is preserved', () => {
      const violations = findUnsupportedPossessionClaims(
        'I would like to develop my skills in Kubernetes.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('does not flag the existing accepted "develop further experience with X" phrasing (further modifies the noun, not the verb)', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am eager to develop further experience with cloud platforms.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('flags "further develop my knowledge of X" the same way as "skills"', () => {
      const violations = findUnsupportedPossessionClaims(
        'I want to further develop my knowledge of Kubernetes.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('kubernetes'))).toBe(true);
    });

    it('a mixed sentence with genuine learning intent AND an unsupported claim still flags only the unsupported part', () => {
      const violations = findUnsupportedPossessionClaims(
        "I'm keen to learn Docker, and I can also further develop my skills in Kubernetes.",
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('docker'))).toBe(false);
      expect(violations.some((v) => v.includes('kubernetes'))).toBe(true);
    });

    it('generic database work does not, by itself, substantiate SQL or relational databases specifically', () => {
      // DATABASE_WORK_EVIDENCE's experienceText literally says "Managed
      // internal databases" — confirms this alone is never treated as
      // sufficient grounding for a claim naming SQL/relational databases.
      const violations = findUnsupportedPossessionClaims(
        'I have hands-on experience with SQL and relational databases.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('sql'))).toBe(true);
      expect(violations.some((v) => v.includes('relational database'))).toBe(true);
    });

    // Found via this fix's own real-call verification (not the original
    // reported pair) — confirms generic database work does not, by itself,
    // substantiate a claim of having worked with relational databases
    // SPECIFICALLY, even phrased as "honed my ability" rather than
    // "experience with."
    it('flags "this experience honed my ability to work with relational databases" for generic database work', () => {
      const violations = findUnsupportedPossessionClaims(
        'This experience honed my ability to work with relational databases, a crucial part of ' +
          'your role.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('relational database'))).toBe(true);
    });

    it('still flags a genuinely unsupported skill-only claim about a supported skill spelled differently (plural)', () => {
      const violations = findUnsupportedPossessionClaims(
        'I have a solid understanding of relational databases.',
        DATABASE_WORK_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('relational database'))).toBe(true);
    });
  });

  // ─── V5 (RABBIT_NOTEBOOK.md §57): a third production letter, generated
  // after the §56 fix deployed, still claimed JavaScript and React — this
  // time hedged as "my ... experience with X is limited" (a word-order
  // variant of "I have limited experience with X" the existing pattern
  // didn't cover) paired with "expanding my proficiency in these areas"
  // ("proficiency" was simply absent from every noun list). Both gaps are
  // fixed in the EXPERIENCE_CLAIM_PATTERNS/ASPIRATIONAL_OVERRIDE_PATTERNS
  // additions this section traces to.
  describe('V5 — "experience ... is limited" and "proficiency" phrasing', () => {
    const NO_JS_REACT_EVIDENCE: CvEvidence = {
      experienceText:
        'Recent Computer Science graduate with academic coursework in algorithms and data ' +
        'structures. Completed a university group project building a simple inventory ' +
        'tracking spreadsheet tool.',
      skillsOnlyTerms: [],
    };

    const JS_REACT_EVIDENCE: CvEvidence = {
      experienceText:
        'Frontend Developer at Acme Ltd. Built and maintained production web applications ' +
        'using JavaScript and React.',
      skillsOnlyTerms: [],
    };

    // The exact real sentence from the §57 production recheck (113.pdf).
    const REAL_SENTENCE =
      'Though my professional experience with JavaScript and React is limited, I am ' +
      'enthusiastic about expanding my proficiency in these areas.';

    it('flags the exact real "experience ... is limited" + "expanding my proficiency" sentence when unsupported', () => {
      const violations = findUnsupportedPossessionClaims(REAL_SENTENCE, NO_JS_REACT_EVIDENCE);
      expect(violations.some((v) => v.includes('javascript'))).toBe(true);
      expect(violations.some((v) => v.includes('react'))).toBe(true);
    });

    it('does not flag the same sentence when the CV genuinely establishes the experience', () => {
      // A hedged ("limited") but genuine claim about real work-history
      // evidence is not a fabrication — this proves the fix targets the
      // missing pattern coverage, not "limited"/"proficiency" wording itself.
      const violations = findUnsupportedPossessionClaims(REAL_SENTENCE, JS_REACT_EVIDENCE);
      expect(violations).toEqual([]);
    });

    it('does not flag "expanding my proficiency in X" alone, with no hedge — genuine learning intent is preserved', () => {
      const violations = findUnsupportedPossessionClaims(
        'I am enthusiastic about expanding my proficiency in Kubernetes.',
        NO_JS_REACT_EVIDENCE,
      );
      expect(violations).toEqual([]);
    });

    it('flags "my experience with X is limited" on its own (without the proficiency clause)', () => {
      const violations = findUnsupportedPossessionClaims(
        'My experience with Kubernetes is limited.',
        NO_JS_REACT_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('kubernetes'))).toBe(true);
    });

    // A mixed pair of SEPARATE sentences: genuine aspirational language about
    // one unsupported technology must not exempt a hedged-but-unsupported
    // experience claim about a different one elsewhere in the same letter.
    it('a genuine learning-intent sentence does not exempt a separate hedged-experience claim about a different technology', () => {
      const violations = findUnsupportedPossessionClaims(
        'I would welcome the opportunity to learn Kubernetes. Though my professional ' +
          'experience with Docker is limited, I am enthusiastic about expanding my ' +
          'proficiency in this area.',
        NO_JS_REACT_EVIDENCE,
      );
      expect(violations.some((v) => v.includes('kubernetes'))).toBe(false);
      expect(violations.some((v) => v.includes('docker'))).toBe(true);
    });
  });
});
