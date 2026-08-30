import { findUnsupportedPossessionClaims } from './possession-claim-guard.util';

const CV_TEXT =
  'Software engineer with 3 years of experience building web applications in TypeScript ' +
  'and JavaScript. Strong communicator with a BSc in Computer Science.';

describe('findUnsupportedPossessionClaims()', () => {
  // ─── The exact "BAD" examples from manual regression testing ────────────────

  it('flags "I am proficient in Python."', () => {
    const violations = findUnsupportedPossessionClaims('I am proficient in Python.', CV_TEXT);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags "I have strong REST API experience."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I have strong REST API experience.',
      CV_TEXT,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags "I am well-versed in Git and Docker."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am well-versed in Git and Docker.',
      CV_TEXT,
    );
    // Both Git and Docker are unsupported — expect a violation for each.
    expect(violations.length).toBe(2);
  });

  it('flags "I have experience optimizing PostgreSQL/MySQL queries."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I have experience optimizing PostgreSQL/MySQL queries.',
      CV_TEXT,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  // ─── The exact "GOOD" aspirational examples — must never be flagged ────────

  it('does not flag "I am interested in expanding my Docker knowledge."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am interested in expanding my Docker knowledge.',
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });

  it('does not flag "I am eager to develop further experience with cloud platforms."', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am eager to develop further experience with cloud platforms.',
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });

  // ─── Supported skills must never be flagged ────────────────────────────────

  it('does not flag a possession claim about a skill genuinely present in the CV', () => {
    const violations = findUnsupportedPossessionClaims(
      'I am proficient in TypeScript and JavaScript.',
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });

  it('does not flag ordinary CV-grounded prose with no possession-pattern phrasing', () => {
    const violations = findUnsupportedPossessionClaims(
      'My three years building web applications make me well-suited for this role.',
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });

  // ─── Negation / disclaimer framing must never be flagged ───────────────────

  it('does not flag a sentence that explicitly disclaims the technology', () => {
    const violations = findUnsupportedPossessionClaims(
      "While I haven't directly used Docker, I have strong experience with similar tooling.",
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });

  // ─── Ambiguous phrasing (no clear possession pattern) is left unflagged ────

  it('does not flag a bare mention with no possession-pattern verb', () => {
    const violations = findUnsupportedPossessionClaims(
      'The team uses Docker extensively for deployments.',
      CV_TEXT,
    );
    expect(violations).toEqual([]);
  });
});
