import { PDFParse } from 'pdf-parse';
import { ConfigService } from '@nestjs/config';

import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';

/**
 * RABBIT_NOTEBOOK.md §47/§48 — end-to-end (within this repo, no network
 * except the mocked OpenAI client below) proof that the fix actually
 * closes the loop reported in the bug: mapping -> saving -> PDF export.
 *
 * REAL_MODEL_RESPONSE below is not hand-written — it is the ACTUAL,
 * unedited JSON response captured from one real, paid, local-dev
 * (NOT production) gpt-4o-mini call, made directly against the real
 * pdf-parse text of the real reported source PDF
 * (`Alex_Johnson (32).pdf`, from D:\Downloads), importing this same
 * commit's real, unmodified SYSTEM_PROMPT/JSON_SCHEMA_HINT constants
 * directly (no hand-duplication) rather than an inlined copy. See §47 for
 * the original before/after evidence (the pre-fix prompt omitted
 * summary/qualities/references/nationality entirely) and §48 for the two
 * later, narrower fixes this specific fixture also demonstrates: both
 * education entries' `location` (previously omitted by one real
 * production call despite being schema-supported since §47), and the
 * first reference's field split (previously `jobTitle: "Manager"` with
 * `company: "JKT, Sumangaya"` merged and no `relationship` at all —
 * now correctly `jobTitle: "JKT"`, `company: "Sumangaya"`,
 * `relationship: "Manager"`, consistent with the second reference's own,
 * already-correct split in the same response).
 *
 * From here on everything is deterministic, real production code, no
 * mocks: PrefillExtractionService's real Zod parsing + mapToContent (only
 * the OpenAI HTTP call itself is mocked, to replay the captured response
 * instead of spending again), then the real PdfGenerationService
 * (profile-pdf-renderer.ts, completely untouched by §47/§48) generates an
 * actual PDF, which is then independently re-extracted with pdf-parse —
 * the same "don't trust that a render looked right, verify the actual
 * bytes" standard pdf-generation.service.spec.ts already uses elsewhere.
 *
 * This is still a LOCAL test — it does not touch the database, R2, or any
 * deployed environment, and is not a claim of production verification.
 */

const REAL_MODEL_RESPONSE = {
  personalDetails: {
    fullName: 'Alex Johnson',
    email: 'alex.johnson@university.ac.uk',
    phone: '+44 7700 900000',
    location: 'London, UK',
    linkedIn: 'linkedin.com/in/endrick-mollel',
    nationality: 'Tanzanian',
  },
  summary:
    'Motivated Computer Science graduate with experience in full-stack web development, seeking a software engineering role in a fast-paced technology company. Motivated Computer Science graduate with experience in full-stack web development, seeking a software engineering role in a fast-paced technology company. Motivated Computer Science graduate with experience in full-stack web development, seeking a software engineering role in a fast-paced technology company.',
  workExperience: [
    {
      company: 'Tech Startup Ltd',
      title: 'Software Engineering Intern',
      location: 'London, UK',
      startDate: '2024-06',
      endDate: '2024-09',
      current: false,
      bullets: [
        'Built REST APIs using Node.js and TypeScript, serving 10,000+ daily active users',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'Collaborated with a team of 5 engineers using Agile methodology',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'Built REST APIs using Node.js and TypeScript, serving 10,000+ daily active users',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
      ],
    },
    {
      company: 'Tanzania Railway Corporation',
      title: 'Backend Engineer',
      location: 'Dar Es Salaam',
      startDate: '2025-03',
      current: true,
      bullets: [
        'Reduced page load time by 40% through frontend optimisation and lazy loading.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.Reduced page load time by 40% through frontend optimisation and lazy loading',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
      ],
    },
    {
      company: 'Evatho Matrix Security',
      title: 'Operation Manager',
      location: 'Dar es salaam',
      startDate: '2021-03',
      endDate: '2028-04',
      current: false,
      bullets: [
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading.',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'uilt REST APIs using Node.js and TypeScript, serving 10,000+ daily active users.',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
      ],
    },
  ],
  education: [
    {
      institution: 'University of London',
      degree: 'BSc Computer Science',
      field: 'Computer Science',
      location: 'London, UK',
      startDate: '2021-09',
      endDate: '2024-06',
      grade: '2:1 (Upper Second Class)',
    },
    {
      institution: 'Marwadi University',
      degree: 'Diploma',
      field: 'Computer Engineering',
      location: 'Gujarat - India',
      startDate: '2021-03',
      endDate: '2024-03',
      grade: '9',
    },
  ],
  // Note: both entries' `location` was ALSO present in the earlier §47-only
  // (v3) capture — this specific local test call happened to get it right
  // both times. §48's own real production import is what surfaced the
  // omission (a real, separate call) that this fixture can't reproduce by
  // itself — see §48's own notebook entry for that evidence; the
  // `references` below are what actually changed in this v4 capture.
  skills: [
    { name: 'TypeScript' },
    { name: 'React' },
    { name: 'Node.js' },
    { name: 'Python' },
    { name: 'SQL' },
  ],
  languages: [{ name: 'English' }],
  qualities: [
    'Time management',
    'Strong Communication Skills',
    'Leadership',
    'Strong Foundation in living and interacting with diversed communities',
    'Expereience in Refugees',
    'Travelling Internationally',
    'Strong Cultural Adaptation',
    'Strong weather condition adaptation',
    'Experience in working with Big Data',
    'Expereience in statistics and using MongoDB',
    'WHO secret keeper',
  ],
  references: [
    {
      fullName: 'Endrick Mollel',
      jobTitle: 'JKT',
      company: 'Sumangaya',
      relationship: 'Manager',
      email: 'endrickmollel34@gmail.com',
      phone: '0465739452',
    },
    {
      fullName: 'Anorld Joachim',
      jobTitle: 'Supervisor',
      company: 'Tanzania Army',
      relationship: 'Manager',
      email: 'Anorldjoachim@gmail.com',
      phone: '0772351965',
    },
  ],
};

const mockCreate = jest.fn();

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  })),
);

const mockConfig = { getOrThrow: jest.fn(() => 'test-key') } as unknown as ConfigService;

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

describe('Prefill -> PDF, real captured model response (§47/§48)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(REAL_MODEL_RESPONSE) } }],
      usage: { total_tokens: 2930 },
    });
  });

  it('carries the summary, all 11 Qualities, both References, education locations, and nationality all the way into a real Profile-template PDF', async () => {
    const prefill = new PrefillExtractionService(mockConfig);
    const { content } = await prefill.extract(
      'irrelevant — OpenAI call is mocked to replay the real captured response above',
    );

    // §48: precise, unambiguous checks directly on the mapped content —
    // both education entries keep their location, and the first
    // reference's fields land in their correct, meaning-preserving slots
    // (not just "the words survived somewhere").
    expect(content.education[0]?.location).toBe('London, UK');
    expect(content.education[1]?.location).toBe('Gujarat - India');
    expect(content.references?.[0]).toMatchObject({
      fullName: 'Endrick Mollel',
      jobTitle: 'JKT',
      company: 'Sumangaya',
      relationship: 'Manager',
    });

    const pdf = new PdfGenerationService();
    const buffer = await streamToBuffer(pdf.generateStream(content, 'Alex Johnson CV', 'profile'));
    const text = await extractPdfText(buffer);

    // Normalized (whitespace-collapsed) comparison — the real PDF wraps a
    // long Quality across multiple lines within the narrow sidebar column
    // (e.g. "Strong Foundation in living and\ninteracting with diversed\n
    // communities"), so pdf-parse's own line breaks would otherwise make an
    // exact, un-normalized `toContain` check on the full sentence fail for
    // a reason that has nothing to do with whether the content is actually
    // there — the same line-wrap artifact already identified and worked
    // around in RABBIT_NOTEBOOK.md §46's own PDF text-continuity checks.
    const normalized = text.replace(/\s+/g, ' ');
    expect(normalized).toContain('Tanzanian');
    expect(normalized).toContain('Motivated Computer Science graduate');
    for (const q of REAL_MODEL_RESPONSE.qualities) {
      expect(normalized).toContain(q.replace(/\s+/g, ' '));
    }
    // §48: both education entries' locations actually reach the rendered
    // PDF text too (profile-pdf-renderer.ts's renderEducationEntry joins
    // institution + location with " · " — see that function's own code).
    expect(normalized).toContain('University of London · London, UK');
    expect(normalized).toContain('Marwadi University · Gujarat - India');
    expect(text).toContain('Endrick Mollel');
    expect(text).toContain('endrickmollel34@gmail.com');
    expect(text).toContain('Anorld Joachim');
    expect(text).toContain('Anorldjoachim@gmail.com');
  });

  it('renders the summary and References on Modern too, but never Qualities/nationality — an intentional template limitation, not lost data', async () => {
    // Distinguishes "the field is missing from saved data" (§47's actual
    // bug, now fixed) from "the selected template simply doesn't have a
    // slot for it" (CvContent.qualities' own doc comment: "never rendered
    // by any of the other six templates" — pre-existing, intentional, not
    // part of this fix). The reported bug's own exports (`Alex_Johnson
    // (34).pdf`/`(35).pdf`) were NOT the Profile template, so this is the
    // realistic before/after comparison for those exact exports.
    const prefill = new PrefillExtractionService(mockConfig);
    const { content } = await prefill.extract(
      'irrelevant — OpenAI call is mocked to replay the real captured response above',
    );

    const pdf = new PdfGenerationService();
    const buffer = await streamToBuffer(pdf.generateStream(content, 'Alex Johnson CV', 'modern'));
    const text = await extractPdfText(buffer);

    expect(text).toContain('Motivated Computer Science graduate');
    expect(text).toContain('Endrick Mollel');
    expect(text).toContain('Anorld Joachim');
    expect(text).not.toContain('Tanzanian');
    expect(text).not.toContain('Time management');
  });
});
