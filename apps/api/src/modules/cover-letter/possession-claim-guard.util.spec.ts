import type { CvEvidence } from './cv-evidence.util';
import { findUnsupportedPossessionClaims } from './possession-claim-guard.util';

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
  });
});
