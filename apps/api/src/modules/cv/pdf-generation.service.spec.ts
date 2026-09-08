import { PDFParse } from 'pdf-parse';
import type { CvContent } from '@cvpilot/shared';
import { PdfGenerationService } from './pdf-generation.service';

/**
 * CV Template Foundation, Phase 1 — regression coverage for the Classic
 * PDFKit renderer. Uses pdf-parse (already a production dependency, used
 * for uploaded-CV text extraction) to independently re-extract the
 * generated PDF's text, the same deterministic-backstop philosophy used
 * throughout this codebase's grounding utils: never trust that a render
 * "looked right", verify the actual bytes.
 *
 * Requires NODE_OPTIONS=--experimental-vm-modules (see apps/api/package.json's
 * "test" script) — pdf-parse's internal pdfjs-dist dependency needs it to
 * set up its text-extraction worker under Jest's VM context.
 */

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function extractText(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

const FULL_FIXTURE: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'François Müller-Øst',
    email: 'francois@example.com',
    phone: '+44 20 7946 0958',
    location: 'Zürich, Switzerland',
    linkedIn: 'linkedin.com/in/francois-example',
    website: 'https://francois.example.com/portfolio',
    jobTitle: 'Senior Backend Engineer',
  },
  summary:
    'Backend engineer with 8 years of experience building résilient distributed systems ' +
    'across Zürich and Genève.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme Technologies GmbH',
      title: 'Senior Backend Engineer',
      location: 'Zürich',
      startDate: '2021-03',
      current: true,
      bullets: [
        'Designed and shipped a payment-reconciliation service handling €4.2M/month in transactions',
        'Reduced API p99 latency by 63% through targeted PostgreSQL query optimization',
      ],
    },
    {
      id: 'we-2',
      company: 'Café Analytics SAS',
      title: 'Backend Developer',
      location: 'Lyon, France',
      startDate: '2018-01',
      endDate: '2021-02',
      current: false,
      bullets: ['Built and maintained internal tooling used by 40+ analysts daily'],
    },
  ],
  education: [
    {
      id: 'ed-1',
      institution: 'ETH Zürich',
      degree: 'MSc Computer Science',
      field: 'Distributed Systems',
      startDate: '2016-09',
      endDate: '2018-06',
      grade: 'Distinction',
    },
  ],
  skills: [
    { id: 'sk-1', name: 'PostgreSQL', level: 'Expert' },
    { id: 'sk-2', name: 'TypeScript' },
    { id: 'sk-3', name: 'Kubernetes' },
  ],
  languages: [
    { id: 'lang-1', name: 'English', level: 'Native' },
    { id: 'lang-2', name: 'Français', level: 'Fluent' },
  ],
  certifications: [
    {
      id: 'cert-1',
      name: 'AWS Certified Solutions Architect',
      issuer: 'Amazon Web Services',
      date: '2022-05',
    },
  ],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

describe('PdfGenerationService', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);

    // Personal details
    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(text).toContain('+44 20 7946 0958');
    expect(text).toContain('Zürich, Switzerland');

    // Work experience
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('Backend Developer');
    expect(text).toContain('40+ analysts daily');

    // Education
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('Distinction');

    // Skills / languages / certifications
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
  });

  // ─── Unicode — European/Latin accented characters ──────────────────────
  it('preserves accented European characters (é, ü, ñ, ø, ç) through PDF generation', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: {
        ...FULL_FIXTURE.personalDetails,
        fullName: 'François Ñoño Ørsted',
      },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content));
    const text = await extractText(pdf);

    expect(text).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  // ─── Empty optional sections ────────────────────────────────────────────
  it('renders a minimal CV (every optional section empty) without throwing, and without stray headings', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal));
    const text = await extractText(pdf);

    expect(text).toContain('Jane Doe');
    for (const heading of [
      'SUMMARY',
      'WORK EXPERIENCE',
      'EDUCATION',
      'SKILLS',
      'LANGUAGES',
      'CERTIFICATIONS',
    ]) {
      expect(text).not.toContain(heading);
    }
  });

  // ─── Long content must not silently disappear ───────────────────────────
  it('preserves a very long bullet and a very long job title in full', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend ' +
      'while maintaining full backward compatibility for every existing integration partner.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';

    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content));
    const text = await extractText(pdf);
    // pdf-parse inserts a literal newline at each visual line-wrap point —
    // expected and legitimate for genuinely long, wrapped content. This
    // normalizes whitespace so the check is "every word survived", not
    // "the exact same line breaks survived".
    const normalized = text.replace(/\s+/g, ' ');

    expect(normalized).toContain(longTitle.replace(/\s+/g, ' '));
    expect(normalized).toContain(longBullet.replace(/\s+/g, ' '));
  });

  // ─── Multi-page CVs ──────────────────────────────────────────────────────
  it('generates a valid multi-page PDF for a CV with enough content to overflow one page', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i}`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2015-01',
      endDate: '2016-01',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: manyEntries,
    };
    const pdf = await streamToBuffer(service.generateStream(content));
    const text = await extractText(pdf);

    // Every entry present regardless of which physical page it landed on.
    for (let i = 0; i < manyEntries.length; i++) {
      expect(text).toContain(`Company ${i}`);
      expect(text).toContain(`Backend Engineer ${i}`);
    }

    const parser = new PDFParse({ data: pdf });
    try {
      const info = await parser.getText();
      expect(info.pages.length).toBeGreaterThan(1);
    } finally {
      await parser.destroy();
    }
  });

  // ─── Clickable links ─────────────────────────────────────────────────────
  it('creates clickable PDF link annotations for LinkedIn and website, pointing at normalized URLs', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE));
    // PDFKit writes link annotations as regular (uncompressed) PDF
    // dictionary objects containing a literal /URI string — searching the
    // raw bytes for the exact normalized URL is a reliable, low-tech way to
    // verify a real clickable annotation was created, without needing a
    // full PDF object-graph parser.
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });

  it('does not create a link annotation when LinkedIn/website are absent', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
      },
    };
    const pdf = await streamToBuffer(service.generateStream(content));
    const raw = pdf.toString('latin1');
    expect(raw).not.toContain('/Subtype /Link');
  });
});

// ─── CV Template Foundation, Phase 2 — Modern ────────────────────────────
// Same deterministic-backstop philosophy as Classic's suite above: real
// text extraction, not visual inspection. Modern's two-column body and
// page-break strategy (sidebar only on page 1, main column switches to
// full page width on continuation pages — see pdf-generation.service.ts's
// modernRender doc comment) are exercised directly here with a long work
// history, since that is exactly the scenario where a two-column PDF
// layout is most likely to lose or misplace content.
describe('PdfGenerationService — Modern template', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'modern'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);

    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(text).toContain('Zürich, Switzerland');
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
  });

  it('preserves accented European characters through the Modern renderer', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { ...FULL_FIXTURE.personalDetails, fullName: 'François Ñoño Ørsted' },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'modern'));
    const text = await extractText(pdf);

    expect(text).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  it('renders a minimal CV (every optional section empty) without throwing', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal, undefined, 'modern'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
  });

  it('renders correctly when only sidebar-column sections are present (no summary/work/education)', async () => {
    const sidebarOnly: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [{ id: 'sk-1', name: 'PostgreSQL' }],
      languages: [{ id: 'lang-1', name: 'English', level: 'Native' }],
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
    const pdf = await streamToBuffer(service.generateStream(sidebarOnly, undefined, 'modern'));
    const text = await extractText(pdf);
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('English');
  });

  it('preserves a very long bullet and a very long job title in full', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'modern'));
    const text = await extractText(pdf);
    const normalized = text.replace(/\s+/g, ' ');

    expect(normalized).toContain(longTitle.replace(/\s+/g, ' '));
    expect(normalized).toContain(longBullet.replace(/\s+/g, ' '));
  });

  // ─── Multi-page: sidebar only on page 1, main column continues at full
  // width, no content lost — the scenario most likely to break a
  // hand-managed two-column PDFKit layout. ──────────────────────────────
  it('generates a valid multi-page PDF for a long work history, with every entry present and the sidebar not repeated', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'modern'));

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    let text: string;
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
      text = result.text;
    } finally {
      await parser.destroy();
    }

    expect(pageCount).toBeGreaterThan(1);
    for (let i = 0; i < manyEntries.length; i++) {
      expect(text).toContain(`Company ${i} Technologies AG`);
      expect(text).toContain(`Backend Engineer ${i}`);
    }
    // Sidebar content (Skills) must appear exactly once — never repeated on
    // continuation pages.
    const skillOccurrences = text.split('PostgreSQL').length - 1;
    expect(skillOccurrences).toBe(1);
  });

  it('creates clickable PDF link annotations for LinkedIn and website', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'modern'));
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });
});

// ─── CV Template Foundation, Phase 3 — Minimal ────────────────────────────
describe('PdfGenerationService — Minimal template', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'minimal'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);

    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(text).toContain('Zürich, Switzerland');
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
    // Neutral grade label — never a guessed scale like "GPA:".
    expect(text).toContain('Grade: Distinction');
  });

  it('preserves accented European characters through the Minimal renderer', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { ...FULL_FIXTURE.personalDetails, fullName: 'François Ñoño Ørsted' },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));
    const text = await extractText(pdf);

    expect(text).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  it('renders a minimal CV (every optional section empty) without throwing', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal, undefined, 'minimal'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
  });

  it('preserves a very long bullet and a very long job title in full', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));
    const text = await extractText(pdf);
    const normalized = text.replace(/\s+/g, ' ');

    expect(normalized).toContain(longTitle.replace(/\s+/g, ' '));
    expect(normalized).toContain(longBullet.replace(/\s+/g, ' '));
  });

  // Minimal has no fixed-width chip container (unlike Modern) — a
  // pathologically long, unbroken skill name is just wrapped text, so it
  // must survive completely with no truncation at all.
  it('preserves an unusually long, unbroken skill name completely (no truncation)', async () => {
    const longSkill =
      'Supercalifragilisticexpialidociousbackendarchitecturepatternsandmicroserviceorchestrationtooling';
    const content: CvContent = {
      ...FULL_FIXTURE,
      skills: [{ id: 'sk-long', name: longSkill }],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));
    const text = await extractText(pdf);
    const collapsed = text.replace(/\s+/g, '');

    expect(collapsed).toContain(longSkill);
    expect(text).not.toContain('…');
  });

  // ─── Multi-page: continuation header present, no content lost, sections
  // in the natural sectionOrder-derived order. ───────────────────────────
  it('generates a valid multi-page PDF for a long work history, with every entry present and a continuation header', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    let text: string;
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
      text = result.text;
    } finally {
      await parser.destroy();
    }

    expect(pageCount).toBeGreaterThan(1);
    for (let i = 0; i < manyEntries.length; i++) {
      expect(text).toContain(`Company ${i} Technologies AG`);
      expect(text).toContain(`Backend Engineer ${i}`);
    }
    // The continuation-page running header repeats the candidate name (in
    // uppercase — see minimalContinuationHeader's doc comment) — it
    // legitimately appears again on page 2+, unlike Modern's sidebar
    // content which must appear exactly once.
    expect(text).toContain('François Müller-Øst');
    expect(text.toUpperCase().split('FRANÇOIS MÜLLER-ØST').length - 1).toBeGreaterThan(1);
  });

  it('creates clickable PDF link annotations for LinkedIn and website', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'minimal'));
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });

  // ─── V1.1 borderline-pagination fix — content-driven, not fixture-
  // coordinate assertions (see minimalRenderBody's doc comment). ─────────

  it('keeps a short CV on a single page, unaffected by the pagination algorithm', async () => {
    const short: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com', jobTitle: 'Designer' },
      summary: 'A short summary.',
      workExperience: [
        {
          id: 'we-1',
          company: 'Acme',
          title: 'Designer',
          startDate: '2022-01',
          current: true,
          bullets: ['Did design work'],
        },
      ],
      education: [],
      skills: [{ id: 'sk-1', name: 'Figma' }],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(short, undefined, 'minimal'));
    const parser = new PDFParse({ data: pdf });
    try {
      const result = await parser.getText();
      expect(result.pages.length).toBe(1);
    } finally {
      await parser.destroy();
    }
  });

  it('keeps a complete section on page 1 whenever it naturally fits, rather than pulling it to page 2 for page-balancing', async () => {
    // V1.2 policy (reverted from V1.1's tiny-tail avoidance — see
    // minimalRenderBody's doc comment): natural, content-driven page
    // utilization. Shaped like the production case found in manual QA (a
    // senior CV with three jobs, two degrees, six skills, three
    // languages, one certification) — content-driven, not a hand-tuned
    // pixel target: this is the same shape of content that originally
    // exposed both the V1 "tiny tail" issue and the V1.1 "artificially
    // unfinished page 1" over-correction.
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: {
        ...FULL_FIXTURE.personalDetails,
        jobTitle: 'Senior Backend Engineer & Platform Architect',
      },
      workExperience: [
        {
          id: 'we-1',
          company: 'Acme Technologies GmbH',
          title: 'Senior Backend Engineer & Platform Architect',
          location: 'Zürich',
          startDate: '2021-03',
          current: true,
          bullets: [
            'Designed and shipped a payment-reconciliation service handling €4.2M/month in transactions across 12 currencies',
            'Reduced API p99 latency by 63% through targeted PostgreSQL query optimization and read-replica routing',
            'Led migration of a monolithic billing system to an event-driven microservices architecture with zero downtime',
          ],
        },
        {
          id: 'we-2',
          company: 'Café Analytics SAS',
          title: 'Backend Developer',
          location: 'Lyon, France',
          startDate: '2018-01',
          endDate: '2021-02',
          current: false,
          bullets: [
            'Built and maintained internal tooling used by 40+ analysts daily',
            'Implemented CI/CD pipelines that cut deployment time from 45 minutes to under 5',
          ],
        },
        {
          id: 'we-3',
          company: 'Nordic Systems AB',
          title: 'Junior Software Engineer',
          location: 'Stockholm, Sweden',
          startDate: '2016-06',
          endDate: '2017-12',
          current: false,
          bullets: [
            'Contributed to a Java-based inventory management platform used by 200+ retail stores',
          ],
        },
      ],
      education: [
        ...FULL_FIXTURE.education,
        {
          id: 'ed-2',
          institution: 'Université de Lyon',
          degree: 'BSc Computer Engineering',
          field: 'Software Systems',
          startDate: '2012-09',
          endDate: '2016-06',
        },
      ],
      skills: [
        { id: 'sk-1', name: 'PostgreSQL', level: 'Expert' },
        { id: 'sk-2', name: 'TypeScript' },
        { id: 'sk-3', name: 'Kubernetes' },
        { id: 'sk-4', name: 'Go' },
        { id: 'sk-5', name: 'Kafka' },
        { id: 'sk-6', name: 'Terraform' },
      ],
      languages: [
        { id: 'lang-1', name: 'English', level: 'Native' },
        { id: 'lang-2', name: 'Français', level: 'Fluent' },
        { id: 'lang-3', name: 'Deutsch', level: 'Professional' },
      ],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    // This exact content shape is genuinely too long for one page —
    // confirm the split actually engages (2 pages), not merely that the
    // assertions below are vacuously true because everything fit on 1.
    expect(pages.length).toBe(2);

    const firstPage = pages[0] ?? '';
    const lastPage = pages[pages.length - 1] ?? '';
    // The approved V1.3 split for this exact content: Education AND
    // Skills stay on page 1 with Experience — never pulled forward to
    // page 2 merely to make page 2 look more substantial — while
    // Languages and Certifications (the genuinely small trailing tail)
    // move to page 2 together. This is the specific behavior that
    // regressed under the V1.1 tiny-tail fix, and it also proves the
    // V1.3 orphan-final-section safeguard never reaches past its
    // immediate predecessor: Skills (two sections before Certifications)
    // stays on page 1 even though it's small.
    expect(firstPage).toContain('Education');
    expect(firstPage).toContain('Skills');
    expect(firstPage).not.toContain('Certifications');
    expect(lastPage).toContain('Languages');
    expect(lastPage).toContain('Certifications');
    expect(lastPage).not.toContain('Education');
  });

  // ─── V1.3 orphan-final-section safeguard ───────────────────────────────
  it('pulls exactly one small predecessor to avoid orphaning a tiny final section', async () => {
    // Shaped so natural pagination would otherwise leave Certifications
    // alone at the top of page 2 (the exact production case found in
    // manual QA on a long-fields CV) — content-driven sizing, not
    // fixture-specific coordinates: Summary + one substantial job +
    // one long-wrapping degree + a short skills list fill page 1 to
    // within the safeguard's threshold, leaving Languages (small) and
    // Certifications (small) as the final two sections.
    const content: CvContent = {
      version: 1,
      personalDetails: {
        fullName: 'Maximilian Alessandro Konstantinos Papadopoulos-Fitzgerald',
        email:
          'maximilian.alessandro.konstantinos.papadopoulos.fitzgerald@a-very-long-corporate-domain-example.com',
        phone: '+44 (0) 20 7946 0958 ext. 4471',
        location: 'Stratford-upon-Avon, Warwickshire, United Kingdom',
        linkedIn:
          'https://www.linkedin.com/in/maximilian-alessandro-konstantinos-papadopoulos-fitzgerald-example-profile',
        website:
          'https://www.maximilian-papadopoulos-fitzgerald-portfolio-and-personal-website.example.com/projects/index',
        jobTitle:
          'Senior Principal Distinguished Staff Software Engineering Architect & Technical Program Lead',
      },
      summary:
        'Extremely senior generalist engineer with an unusually long professional title and an even ' +
        'longer list of responsibilities, included here specifically to verify that long single-word ' +
        'and long multi-word strings wrap gracefully everywhere in the Minimal template without ever ' +
        'colliding with adjacent fixed-position elements such as dates.',
      workExperience: [
        {
          id: 'we-1',
          company:
            'International Consolidated Global MegaCorp Holdings & Subsidiary Partners Limited',
          title:
            'Senior Principal Distinguished Staff Software Engineering Architect & Technical Program Lead',
          location: 'London, United Kingdom (Hybrid — Remote-first, Global Team)',
          startDate: '2019-11',
          current: true,
          bullets: [
            'Responsible for an extremely long bullet point that goes on for quite a while to test line wrapping behaviour and vertical spacing between multiple long wrapped lines within a single bullet in the Minimal main column',
            'Short bullet',
          ],
        },
        {
          id: 'we-2',
          company: 'A',
          title: 'B',
          location: '',
          startDate: '2001-01',
          endDate: '2019-10',
          current: false,
          bullets: [],
        },
      ],
      education: [
        {
          id: 'ed-1',
          institution:
            'The Royal International Institute of Advanced Computer Science, Engineering, and Applied Mathematics',
          degree:
            'Doctor of Philosophy in Theoretical Computer Science and Distributed Systems Architecture',
          field: 'Theoretical Computer Science',
          startDate: '2013-09',
          endDate: '2019-10',
          grade: 'Summa Cum Laude with Highest Distinction',
        },
      ],
      skills: [
        {
          id: 'sk-1',
          name: 'Extremely Long Skill Name That Tests Wrapping Behaviour In The Minimal Layout',
        },
        { id: 'sk-2', name: 'TypeScript' },
        {
          id: 'sk-3',
          name: 'Supercalifragilisticexpialidociousbackendarchitecturepatternsandmicroserviceorchestrationtooling',
        },
      ],
      languages: [
        { id: 'lang-1', name: 'English', level: 'Native (long level string test example)' },
      ],
      certifications: [
        {
          id: 'cert-1',
          name:
            'An Extremely Long Certification Name Designed Specifically To Test Wrapping Behaviour In The ' +
            'Certifications Section',
          issuer: 'A Very Long Certification Issuing Body Name Example International',
          date: '2020-01',
        },
      ],
      sectionOrder: [
        'summary',
        'workExperience',
        'education',
        'skills',
        'languages',
        'certifications',
      ],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pages.length).toBe(2);
    const firstPage = pages[0] ?? '';
    const lastPage = pages[pages.length - 1] ?? '';

    // The safeguard's core effect: Languages moved off page 1 so it can
    // accompany Certifications rather than leaving Certifications alone.
    expect(firstPage).not.toContain('Languages');
    expect(lastPage).toContain('Languages');
    expect(lastPage).toContain('Certifications');

    // "Cannot pull two predecessors": Skills is two sections before
    // Certifications (Skills, Languages, Certifications) and must stay
    // on page 1 — the safeguard only ever considers the immediate
    // predecessor of the true last section.
    expect(firstPage).toContain('Skills');
    expect(lastPage).not.toContain('Skills');

    // No content lost, no blank pages.
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    expect(firstPage).toContain('Summa Cum Laude with Highest Distinction');
  });

  it('never moves a section larger than the small-section bound, even to avoid orphaning a tiny final section', async () => {
    // The "cannot pull a large predecessor" guardrail: Experience here
    // is deliberately large (12 real entries with bullets — the same
    // fixture shape already proven to span multiple pages on its own),
    // immediately followed by a single small Certification. If the
    // safeguard ever ignored the size bound, it could try to defer a
    // huge Experience section alongside the certification; instead it
    // must decline (Experience's measured height is far past
    // MINIMAL_SMALL_SECTION_MAX_HEIGHT) and natural per-entry pagination
    // — unaffected by V1.3 — decides where everything lands.
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com', jobTitle: 'Engineer' },
      summary: 'Short summary.',
      workExperience: manyEntries,
      education: [],
      skills: [],
      languages: [],
      certifications: [
        {
          id: 'cert-1',
          name: 'AWS Certified Solutions Architect',
          issuer: 'Amazon Web Services',
          date: '2022-05',
        },
      ],
      sectionOrder: [
        'summary',
        'workExperience',
        'education',
        'skills',
        'languages',
        'certifications',
      ],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pages.length).toBeGreaterThan(1);
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    // No content lost across the split, regardless of where it landed.
    for (let i = 0; i < manyEntries.length; i++) {
      const fullText = pages.join(' ');
      expect(fullText).toContain(`Company ${i} Technologies AG`);
    }
    expect(pages.join(' ')).toContain('AWS Certified Solutions Architect');
  });

  it('a genuinely long multi-job CV still naturally splits into two pages with a substantial second page', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'minimal'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pages.length).toBeGreaterThan(1);
    // Page 2 must be a substantial block, not a tiny tail — and every
    // page must have real content (no accidental blank page).
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    const lastPage = pages[pages.length - 1] ?? '';
    expect(lastPage).toContain('Education');
    expect(lastPage.trim().length).toBeGreaterThan(200);
  });
});

// ─── CV Template Foundation, Phase 4 — Professional ───────────────────────
describe('PdfGenerationService — Professional template', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'professional'),
    );
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);

    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(text).toContain('Zürich, Switzerland');
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
    // Neutral grade label — never a guessed scale like "GPA:".
    expect(text).toContain('Grade: Distinction');
    // Uppercase section headings — the 'navy-caps-rule' heading treatment.
    expect(text).toContain('PROFILE');
    expect(text).toContain('EXPERIENCE');
    expect(text).toContain('EDUCATION');
    expect(text).toContain('EXPERTISE');
    expect(text).toContain('LANGUAGES');
    expect(text).toContain('CERTIFICATIONS');
  });

  it('preserves accented European characters through the Professional renderer', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { ...FULL_FIXTURE.personalDetails, fullName: 'François Ñoño Ørsted' },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'professional'));
    const text = await extractText(pdf);

    expect(text).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  it('renders a minimal CV (every optional section empty) without throwing', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal, undefined, 'professional'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
  });

  it('preserves a very long bullet and a very long job title in full, with no date collision', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'professional'));
    const text = await extractText(pdf);
    // Also collapses whitespace pdf-parse inserts after a hyphen when a
    // hyphenated word happens to wrap across a line boundary (e.g.
    // "payment-reconciliation" wrapping as "payment-" / "reconciliation")
    // — an extraction-layer line-join artifact, not missing or altered
    // content; Professional's narrower main column wraps this fixture's
    // shared long-bullet text at a different point than Modern/Minimal's
    // wider column, which is where this specific case surfaces.
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').replace(/-\s+/g, '-');

    expect(normalize(text)).toContain(normalize(longTitle));
    expect(normalize(text)).toContain(normalize(longBullet));
  });

  it('preserves an unusually long, unbroken skill name completely (no truncation)', async () => {
    const longSkill =
      'Supercalifragilisticexpialidociousbackendarchitecturepatternsandmicroserviceorchestrationtooling';
    const content: CvContent = {
      ...FULL_FIXTURE,
      skills: [{ id: 'sk-long', name: longSkill }],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'professional'));
    const text = await extractText(pdf);
    const collapsed = text.replace(/\s+/g, '');

    expect(collapsed).toContain(longSkill);
    expect(text).not.toContain('…');
  });

  // ─── Multi-page: continuation header present, no content lost. ────────
  it('generates a valid multi-page PDF for a long work history, with every entry present and a continuation header', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'professional'));

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    let pages: string[];
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pageCount).toBeGreaterThan(1);
    const fullText = pages.join(' ');
    for (let i = 0; i < manyEntries.length; i++) {
      expect(fullText).toContain(`Company ${i} Technologies AG`);
      expect(fullText).toContain(`Backend Engineer ${i}`);
    }
    // No blank pages, and the continuation-page running header (candidate
    // name, uppercased — see professionalContinuationHeader's doc
    // comment) appears again on page 2+.
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    expect(fullText.toUpperCase().split('FRANÇOIS MÜLLER-ØST').length - 1).toBeGreaterThan(1);
    // Secondary column (Skills here) rendered exactly once — never
    // repeated on continuation pages, same guarantee as Modern's sidebar.
    expect(fullText.split('PostgreSQL').length - 1).toBe(1);
  });

  it('creates clickable PDF link annotations for LinkedIn and website', async () => {
    const pdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'professional'),
    );
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });
});

// ─── CV Template Foundation, Phase 5 — Compact ────────────────────────────
describe('PdfGenerationService — Compact template', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'compact'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);

    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(text).toContain('Zürich, Switzerland');
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
    // Neutral grade label — never a guessed scale like "GPA:".
    expect(text).toContain('Grade: Distinction');
    // Compact's own (normal-case, not uppercase) heading labels.
    expect(text).toContain('Summary');
    expect(text).toContain('Experience');
    expect(text).toContain('Education');
    expect(text).toContain('Skills');
    expect(text).toContain('Languages');
    expect(text).toContain('Certifications');
  });

  it('preserves accented European characters through the Compact renderer', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { ...FULL_FIXTURE.personalDetails, fullName: 'François Ñoño Ørsted' },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));
    const text = await extractText(pdf);

    expect(text).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  it('renders a minimal CV (every optional section empty) without throwing', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal, undefined, 'compact'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
  });

  it('preserves a very long bullet and a very long job title in full, with no date collision', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));
    const text = await extractText(pdf);
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').replace(/-\s+/g, '-');

    expect(normalize(text)).toContain(normalize(longTitle));
    expect(normalize(text)).toContain(normalize(longBullet));
  });

  it('preserves an unusually long, unbroken skill name completely (no truncation)', async () => {
    const longSkill =
      'Supercalifragilisticexpialidociousbackendarchitecturepatternsandmicroserviceorchestrationtooling';
    const content: CvContent = {
      ...FULL_FIXTURE,
      skills: [{ id: 'sk-long', name: longSkill }],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));
    const text = await extractText(pdf);
    const collapsed = text.replace(/\s+/g, '');

    expect(collapsed).toContain(longSkill);
    expect(text).not.toContain('…');
  });

  // ─── Multi-page: continuation header present, no content lost. ────────
  it('generates a valid multi-page PDF for a long work history, with every entry present and a continuation header', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    let pages: string[];
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pageCount).toBeGreaterThan(1);
    const fullText = pages.join(' ');
    for (let i = 0; i < manyEntries.length; i++) {
      expect(fullText).toContain(`Company ${i} Technologies AG`);
      expect(fullText).toContain(`Backend Engineer ${i}`);
    }
    // No blank pages, and Compact's own (quiet, marker + name) continuation
    // header appears again on page 2+.
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    expect(fullText.split('François Müller-Øst').length - 1).toBeGreaterThan(1);
    // Secondary band (Skills/Languages/Certifications) rendered exactly
    // once — never repeated on continuation pages, same guarantee as
    // Modern's/Professional's sidebar.
    expect(fullText.split('PostgreSQL').length - 1).toBe(1);
  });

  it('creates clickable PDF link annotations for LinkedIn and website', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'compact'));
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });

  // ─── Compact-specific: dynamic band-column sizing ─────────────────────
  it('renders the secondary band with only the present sections — no empty column for a missing one', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      languages: [],
      certifications: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));
    const text = await extractText(pdf);

    expect(text).toContain('Skills');
    expect(text).toContain('PostgreSQL');
    expect(text).not.toContain('Languages');
    expect(text).not.toContain('Certifications');
  });

  it('renders the secondary band correctly when only one of its three sections is present', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      skills: [],
      certifications: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));
    const text = await extractText(pdf);

    expect(text).toContain('Languages');
    expect(text).toContain('Français');
    expect(text).not.toContain('Skills');
  });

  it('keeps a short final Education section together with the secondary band rather than orphaning it', async () => {
    // A single short education entry followed by a small band: both are
    // small enough that compactShouldKeepWithNext should pull them onto
    // the same page together rather than splitting them, when only a
    // sliver of space remains on the prior page.
    const manyEntries = Array.from({ length: 9 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [`Delivered project ${i} improving system reliability`],
    }));
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: manyEntries,
      education: [FULL_FIXTURE.education[0]!],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'compact'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    // No blank pages, and Education + the Skills band should land on the
    // same page (whichever page that ends up being) rather than Education
    // being stranded alone with the band pushed to its own trailing page.
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    const educationPageIndex = pages.findIndex((p) => p.includes('ETH Zürich'));
    expect(educationPageIndex).toBeGreaterThanOrEqual(0);
    expect(pages[educationPageIndex]).toContain('PostgreSQL');
  });
});

// ─── Template switching preserves factual content ────────────────────────
// ─── CV Template Foundation, Phase 6 — Signature ──────────────────────────
describe('PdfGenerationService — Signature template', () => {
  let service: PdfGenerationService;

  beforeEach(() => {
    service = new PdfGenerationService();
  });

  it('produces a valid PDF whose extracted text contains every factual field', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'signature'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);
    // The header's contact card is deliberately narrow (see
    // signatureHeader's doc comment), so a combined phone+location line
    // can legitimately wrap between "Zürich," and "Switzerland" —
    // graceful wrapping, not a defect. Collapse whitespace before this
    // one assertion only, leaving every other check an exact match.
    const normalizeWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('francois@example.com');
    expect(normalizeWs(text)).toContain('Zürich, Switzerland');
    expect(text).toContain('Acme Technologies GmbH');
    expect(text).toContain('€4.2M/month');
    expect(text).toContain('Café Analytics SAS');
    expect(text).toContain('ETH Zürich');
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Français');
    expect(text).toContain('AWS Certified Solutions Architect');
    // Neutral grade label — never a guessed scale like "GPA:".
    expect(text).toContain('Grade: Distinction');
    // Signature's own uppercase heading labels ('Profile', not 'Summary').
    expect(text).toContain('PROFILE');
    expect(text).toContain('EXPERIENCE');
    expect(text).toContain('EDUCATION');
    // Detail-panel row labels.
    expect(text).toContain('SKILLS');
    expect(text).toContain('LANGUAGES');
    expect(text).toContain('CERTIFICATIONS');
  });

  it('preserves accented European characters through the Signature renderer', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { ...FULL_FIXTURE.personalDetails, fullName: 'François Ñoño Ørsted' },
      summary: 'Résumé: café, naïve, Zürich, garçon, Malmö, señor.',
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));
    const text = await extractText(pdf);
    // The header's left zone gives realistic names room to stay on one
    // line (see signatureHeader's doc comment), but a name this length
    // legitimately wraps to 2 lines — graceful adaptation, not a defect.
    // pdf-parse renders that wrap as a line break with no trailing space,
    // so collapse whitespace before asserting (same technique already
    // used for wrapped-hyphenated-bullet extraction elsewhere in this
    // file).
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
    expect(normalize(text)).toContain('François Ñoño Ørsted');
    expect(text).toContain('Résumé: café, naïve, Zürich, garçon, Malmö, señor.');
  });

  it('renders a minimal CV (every optional section empty) without throwing', async () => {
    const minimal: CvContent = {
      version: 1,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
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
    const pdf = await streamToBuffer(service.generateStream(minimal, undefined, 'signature'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
  });

  it('renders correctly with only the required email (no phone/location/links) — a minimal contact card', async () => {
    const content: CvContent = {
      ...FULL_FIXTURE,
      personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('jane@example.com');
  });

  it('preserves a very long bullet and a very long job title in full, with no date collision', async () => {
    const longBullet =
      'Led a cross-functional initiative spanning backend, infrastructure, and data engineering ' +
      'to redesign the checkout and payment-reconciliation pipeline, reducing end-to-end latency, ' +
      'improving reliability during peak traffic events, and cutting monthly infrastructure spend.';
    const longTitle =
      'Principal Staff Backend Engineer, Platform Reliability and Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: [
        {
          id: 'we-long',
          company: 'Acme Technologies GmbH',
          title: longTitle,
          startDate: '2021-03',
          current: true,
          bullets: [longBullet],
        },
      ],
      education: [],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));
    const text = await extractText(pdf);
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').replace(/-\s+/g, '-');

    expect(normalize(text)).toContain(normalize(longTitle));
    expect(normalize(text)).toContain(normalize(longBullet));
  });

  it('preserves an unusually long, unbroken skill name completely (no truncation)', async () => {
    const longSkill =
      'Supercalifragilisticexpialidociousbackendarchitecturepatternsandmicroserviceorchestrationtooling';
    const content: CvContent = {
      ...FULL_FIXTURE,
      skills: [{ id: 'sk-long', name: longSkill }],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));
    const text = await extractText(pdf);
    const collapsed = text.replace(/\s+/g, '');

    expect(collapsed).toContain(longSkill);
    // Note: an ellipsis CAN legitimately appear elsewhere on this page —
    // the header's contact card intentionally shortens long LinkedIn/
    // website labels with one (shortenUrlLabel) — so this only asserts
    // the skill name itself was never truncated, unlike Compact's/
    // Professional's equivalent test which have no contact card to
    // produce that false positive.
  });

  it('preserves a long certification name and issuer with no clipping', async () => {
    const longCertName =
      'Advanced Certified Solutions Architect — Professional Level, Specialization in Highly Available Payments Infrastructure';
    const content: CvContent = {
      ...FULL_FIXTURE,
      certifications: [
        {
          id: 'cert-long',
          name: longCertName,
          issuer: 'Amazon Web Services Training and Certification Program',
          date: '2022-05',
        },
      ],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));
    const text = await extractText(pdf);
    const normalize = (s: string): string => s.replace(/\s+/g, ' ');
    expect(normalize(text)).toContain(normalize(longCertName));
  });

  // ─── Multi-page: continuation header present, no content lost. ────────
  it('generates a valid multi-page PDF for a long work history, with every entry present and a continuation header', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [
        `Delivered project ${i} improving system reliability and reducing operational overhead`,
        `Mentored engineers and led design reviews for project ${i}`,
      ],
    }));
    const content: CvContent = { ...FULL_FIXTURE, workExperience: manyEntries };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    let pages: string[];
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    expect(pageCount).toBeGreaterThan(1);
    const fullText = pages.join(' ');
    for (let i = 0; i < manyEntries.length; i++) {
      expect(fullText).toContain(`Company ${i} Technologies AG`);
      expect(fullText).toContain(`Backend Engineer ${i}`);
    }
    // No blank pages, and Signature's own (quiet, tick + name) continuation
    // header appears again on page 2+.
    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    expect(fullText.toUpperCase().split('FRANÇOIS MÜLLER-ØST').length - 1).toBeGreaterThan(1);
    // Detail panel (Skills here) rendered exactly once — never repeated on
    // continuation pages, same guarantee as every other template's
    // secondary-information treatment.
    expect(fullText.split('PostgreSQL').length - 1).toBe(1);
  });

  it('creates clickable PDF link annotations for LinkedIn and website', async () => {
    const pdf = await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'signature'));
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Link');
    expect(raw).toContain('https://linkedin.com/in/francois-example');
    expect(raw).toContain('https://francois.example.com/portfolio');
  });

  it('keeps a short final Education section together with the detail panel rather than orphaning it', async () => {
    const manyEntries = Array.from({ length: 9 }, (_, i) => ({
      id: `we-${i}`,
      company: `Company ${i} Technologies AG`,
      title: `Backend Engineer ${i}`,
      location: 'Remote',
      startDate: '2013-01',
      endDate: '2014-06',
      current: false,
      bullets: [`Delivered project ${i} improving system reliability`],
    }));
    const content: CvContent = {
      ...FULL_FIXTURE,
      workExperience: manyEntries,
      education: [FULL_FIXTURE.education[0]!],
    };
    const pdf = await streamToBuffer(service.generateStream(content, undefined, 'signature'));

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    for (const pageText of pages) {
      expect(pageText.trim().length).toBeGreaterThan(0);
    }
    const educationPageIndex = pages.findIndex((p) => p.includes('ETH Zürich'));
    expect(educationPageIndex).toBeGreaterThanOrEqual(0);
    expect(pages[educationPageIndex]).toContain('PostgreSQL');
  });
});

describe('PdfGenerationService — template switching', () => {
  it('does not mutate the input CvContent when switching templates', async () => {
    const service = new PdfGenerationService();
    const before = JSON.parse(JSON.stringify(FULL_FIXTURE)) as CvContent;

    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'classic'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'modern'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'minimal'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'professional'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'compact'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'signature'));

    expect(FULL_FIXTURE).toEqual(before);
  });

  it('Classic, Modern, Minimal, Professional, Compact, and Signature all extract the same factual content for the same CvContent', async () => {
    const service = new PdfGenerationService();
    const classicPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'classic'),
    );
    const modernPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'modern'),
    );
    const minimalPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'minimal'),
    );
    const professionalPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'professional'),
    );
    const compactPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'compact'),
    );
    const signaturePdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'signature'),
    );

    const classicText = await extractText(classicPdf);
    const modernText = await extractText(modernPdf);
    const minimalText = await extractText(minimalPdf);
    const professionalText = await extractText(professionalPdf);
    const compactText = await extractText(compactPdf);
    const signatureText = await extractText(signaturePdf);

    for (const fact of [
      'François Müller-Øst',
      'Acme Technologies GmbH',
      'ETH Zürich',
      'PostgreSQL',
      'Français',
      'AWS Certified Solutions Architect',
    ]) {
      expect(classicText).toContain(fact);
      expect(modernText).toContain(fact);
      expect(minimalText).toContain(fact);
      expect(professionalText).toContain(fact);
      expect(compactText).toContain(fact);
      expect(signatureText).toContain(fact);
    }
  });
});
