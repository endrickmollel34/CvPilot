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

// ─── Template switching preserves factual content ────────────────────────
describe('PdfGenerationService — template switching', () => {
  it('does not mutate the input CvContent when switching templates', async () => {
    const service = new PdfGenerationService();
    const before = JSON.parse(JSON.stringify(FULL_FIXTURE)) as CvContent;

    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'classic'));
    await streamToBuffer(service.generateStream(FULL_FIXTURE, undefined, 'modern'));

    expect(FULL_FIXTURE).toEqual(before);
  });

  it('both Classic and Modern extract the same factual content for the same CvContent', async () => {
    const service = new PdfGenerationService();
    const classicPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'classic'),
    );
    const modernPdf = await streamToBuffer(
      service.generateStream(FULL_FIXTURE, undefined, 'modern'),
    );

    const classicText = await extractText(classicPdf);
    const modernText = await extractText(modernPdf);

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
    }
  });
});
