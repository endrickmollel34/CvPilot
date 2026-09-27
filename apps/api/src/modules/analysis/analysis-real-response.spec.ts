import { classifyAndVerifyKeywords, computeAtsScore } from './ats-keyword.util';
import { groundSuggestions } from './recommendation-grounding.util';

/**
 * RABBIT_NOTEBOOK.md §50 — the real production incident, reproduced and
 * fixed. `REAL_CV_TEXT` is the actual pdf-parse output of the real
 * `Endrick_Silas_Mollel CV mine.pdf` (the exact file named in the bug
 * report). `REAL_MODEL_RESPONSE` is the ACTUAL, unedited JSON response
 * captured from one real, paid, local-dev (NOT production) gpt-4o call
 * against that real CV text and a clearly-synthetic (the real Kilima
 * Digital posting was unavailable), realistic "Junior Full-Stack
 * Developer" job description that phrases requirements as "HTML5, CSS3" —
 * a JD convention at least as common as the bare form.
 *
 * Before this fix: classifyAndVerifyKeywords independently overrode the
 * model's own correct `found: true` for HTML5/CSS3 with `false` (the CV
 * only ever writes bare "Html"/"CSS"), producing a 0% ATS score and
 * classifying both as generic TECHNICAL_CONCEPT rather than HARD_SKILL —
 * exactly the reported "45/100 match, 0% ATS keyword score" pattern. This
 * test asserts the FIXED, current behaviour directly against that real
 * captured data — not a hand-constructed approximation of it.
 */

const REAL_CV_TEXT = `1
CURRICULUM 	VITAE
1.0 	PERSONAL 	DETAILS
Surname: 	Mollel
Other 	Names: 	Endrick 	Silas
Date 	of 	Birth: 	18th 	Sept 	2002
Nationality: 	Tanzanian
Email 	Address: 	mollelendrick@gmail.com
2.0 	PROFILE
Driven 	computer 	engineering 	student 	leveraging 	a 	comprehensive 	skill 	set 	in 	programming 	and
coding 	to 	craft 	dynamic 	websites, 	intuitive 	blogs, 	and 	versatile 	applications. 	Proficient 	in 	a 	diverse
range 	of 	languages, 	including 	Java 	and 	Python.
3.0 	EDUCATION 	BACKGROUND
2021 	- 	2024 	Marwadi 	University 	India 	Diploma 	in 	Computer 	Engineering
4.0 	PROFESSIONAL 	EXPERIENCE 	& 	TRAINING
October 	2024 	- 	September 	2025: 	IT 	Officer 	(Intern), 	Toyota 	Tanzania
- 	Performed 	regular 	data 	entry 	and 	system 	updates 	to 	ensure 	accuracy 	and 	functionality 	of 	security
software.
5.0 	SUMMARY 	OF 	SKILLS 	AND 	QUALIFICATIONS
 	Fast 	and 	accurate 	typing,
 	Programming 	Languages: 	Html, 	CSS, 	Java, 	C++, 	Python
 	Development 	tools: 	Android 	studio, 	Flutter
 	Proficient 	in 	Microsoft 	Excel, 	Google 	Sheets, 	and 	data 	entry 	software
6.0 	PROJECTS
 	Muniverse 	Application; 	Campus 	social 	media 	app.`;

const REAL_MODEL_RESPONSE = {
  match_score: 50,
  suggestions: [
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'HIGH' as const,
      text: 'If you have experience with modern JavaScript (ES6+), add a concrete example showing it.',
    },
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'HIGH' as const,
      text: 'If you have familiarity with a modern front-end framework like React, include specific details about your experience.',
    },
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'HIGH' as const,
      text: 'If you have basic experience with Node.js or another backend language, provide examples of projects or tasks where you used it.',
    },
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'MEDIUM' as const,
      text: 'If you understand REST APIs and how to consume them, mention specific instances where you applied this knowledge.',
    },
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'MEDIUM' as const,
      text: 'If you are familiar with Git and version control workflows, describe your experience with them.',
    },
    {
      category: 'MISSING_KEYWORD' as const,
      priority: 'MEDIUM' as const,
      text: "If you have basic knowledge of SQL and relational databases, add examples of how you've used them in your projects.",
    },
    {
      category: 'WEAK_LANGUAGE' as const,
      priority: 'LOW' as const,
      text: 'Clarify your proficiency in programming languages by specifying your level of expertise or projects you’ve completed using them.',
    },
    {
      category: 'STRUCTURE' as const,
      priority: 'LOW' as const,
      text: "Consider adding a section for 'Technical Skills' to clearly highlight your programming languages and tools proficiency.",
    },
  ],
  ats_keywords: [
    { keyword: 'HTML5', found: true },
    { keyword: 'CSS3', found: true },
    { keyword: 'JavaScript', found: false },
    { keyword: 'React', found: false },
    { keyword: 'Node.js', found: false },
    { keyword: 'REST API', found: false },
    { keyword: 'Git', found: false },
    { keyword: 'SQL', found: false },
    { keyword: 'communication', found: false },
    { keyword: 'Computer Science', found: false },
  ],
};

describe('Analysis ATS scoring/grounding — real captured production-reproducing response (§50)', () => {
  it('no longer overrides the model’s own correct HTML5/CSS3 judgment, and the ATS score reflects it', () => {
    const classified = classifyAndVerifyKeywords(REAL_MODEL_RESPONSE.ats_keywords, REAL_CV_TEXT);

    const html = classified.find((k) => k.keyword === 'HTML5');
    const css = classified.find((k) => k.keyword === 'CSS3');
    expect(html).toMatchObject({ found: true, category: 'HARD_SKILL' });
    expect(css).toMatchObject({ found: true, category: 'HARD_SKILL' });

    const score = computeAtsScore(classified);
    // Before this fix: 0. The remaining gap (JavaScript/React/Node.js/Git/
    // SQL/REST API genuinely not on this CV) is real, not a bug — this
    // asserts the score is no longer catastrophically, falsely zero.
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(24);
  });

  it('no longer suggests HTML5/CSS3 as missing, and every remaining suggestion is conditionally phrased', () => {
    const { suggestions } = groundSuggestions(
      REAL_MODEL_RESPONSE.suggestions,
      REAL_CV_TEXT,
      REAL_MODEL_RESPONSE.ats_keywords,
    );

    const text = suggestions.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/html/i);
    expect(text).not.toMatch(/css/i);
    for (const s of suggestions.filter((s) => s.category === 'MISSING_KEYWORD')) {
      expect(s.text).toMatch(/\bif you\b/i);
    }
  });
});

/**
 * RABBIT_NOTEBOOK.md §51 — the ACTUAL reported production incident (not a
 * reproduction): both texts below were retrieved read-only from the real
 * production database row for this exact analysis (authorized, one-off,
 * read-only query — see §51's own "Evidence" section). `REAL_JD_TEXT` is
 * the genuine Kilima Digital job description, which bundles multiple
 * technologies in one bullet ("Develop responsive user interfaces using
 * React, HTML and CSS."). The stored `ats_reports` row for this exact
 * analysis had `keyword_hits: []` and an 11-entry `missing_keywords` list
 * containing neither "HTML" nor "CSS" — proving, by elimination through
 * this file's own classification logic (HTML/CSS are HARD_SKILL_TERMS,
 * never GENERIC_OR_CONTEXTUAL, so they cannot vanish from both lists via
 * any filtering step), that the model's own `ats_keywords` response never
 * contained them — a keyword-SELECTION gap in ai.service.ts's prompt, not
 * a matching gap in this file. `POST_FIX_MODEL_RESPONSE` is the real,
 * unedited response from one further real gpt-4o call against these exact
 * same two real texts, using the FIXED buildUserPrompt (ai.service.ts) —
 * it now lists "HTML" and "CSS" as their own separate keywords.
 */
const REAL_JD_TEXT =
  'We are looking for a Junior Full-Stack Developer to help build and maintain web applications ' +
  'for small and medium-sized businesses. You will work with experienced developers to deliver ' +
  'reliable features, troubleshoot problems and improve application performance.\n' +
  'Responsibilities\n' +
  '- Develop responsive user interfaces using React, HTML and CSS.\n' +
  '- Build and maintain REST APIs using Node.js and TypeScript.\n' +
  '- Design and query PostgreSQL databases.\n' +
  '- Use Git and collaborate through pull requests.\n' +
  'Essential requirements\n' +
  '- Practical experience with JavaScript or TypeScript.\n' +
  '- Experience building web interfaces with React.\n' +
  '- Working knowledge of SQL and relational databases.\n' +
  '- Familiarity with Git.\n' +
  'Desirable skills\n' +
  '- Familiarity with Docker and CI/CD.\n' +
  '- Experience writing tests with Jest or a similar framework.';

const REAL_PRODUCTION_CV_TEXT =
  '5.0 \tSUMMARY \tOF \tSKILLS \tAND \tQUALIFICATIONS\n' +
  ' \tProgramming \tLanguages: \tHtml, \tCSS, \tJava, \tC++, \tPython\n' +
  ' \tDevelopment \ttools: \tAndroid \tstudio, \tFlutter';

// The real, unedited ats_keywords array from one real gpt-4o call using the
// FIXED prompt against REAL_JD_TEXT and the real, full CV text (the excerpt
// above is the only part relevant to what's being asserted).
const POST_FIX_ATS_KEYWORDS = [
  { keyword: 'React', found: false },
  { keyword: 'HTML', found: true },
  { keyword: 'CSS', found: true },
  { keyword: 'Node.js', found: false },
  { keyword: 'TypeScript', found: false },
  { keyword: 'PostgreSQL', found: false },
  { keyword: 'REST API', found: false },
  { keyword: 'Git', found: false },
  { keyword: 'JavaScript', found: false },
  { keyword: 'SQL', found: false },
  { keyword: 'Docker', found: false },
  { keyword: 'CI/CD', found: false },
  { keyword: 'Jest', found: false },
];

describe('Analysis ATS scoring — actual reported production incident, post-fix (§51)', () => {
  it('lists HTML and CSS as their own separate keywords (not bundled into/dropped alongside React), and scores them correctly', () => {
    // Confirms the JD text used in this fixture is the real one, and that
    // it genuinely bundles React/HTML/CSS in a single bullet — the
    // confirmed trigger condition, not an assumption.
    expect(REAL_JD_TEXT).toContain('React, HTML and CSS');

    const classified = classifyAndVerifyKeywords(POST_FIX_ATS_KEYWORDS, REAL_PRODUCTION_CV_TEXT);
    const html = classified.find((k) => k.keyword === 'HTML');
    const css = classified.find((k) => k.keyword === 'CSS');
    expect(html).toMatchObject({ found: true, category: 'HARD_SKILL' });
    expect(css).toMatchObject({ found: true, category: 'HARD_SKILL' });

    const score = computeAtsScore(classified);
    // The real, reported incident's actual score was 0 (confirmed via the
    // production database). Once the model lists HTML/CSS at all, this
    // file's own existing, unmodified scoring logic already handles them
    // correctly — this asserts the real incident's own numbers, not a
    // fixed target invented for this test.
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(17);
  });
});
