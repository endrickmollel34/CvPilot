import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PDFParse } from 'pdf-parse';
import {
  ClassicCvDocument,
  ModernCvDocument,
  MinimalCvDocument,
  ProfessionalCvDocument,
  CompactCvDocument,
  SignatureCvDocument,
  type CvContent,
  type TemplateId,
} from '@cvpilot/shared';
import { PdfGenerationService } from './pdf-generation.service';

// Modelled directly on references-compatibility.spec.ts (RABBIT_NOTEBOOK.md
// §54) — same cross-template, preview+PDF, legacy-compatibility pattern,
// scoped to the fields Projects actually adds. Profile is intentionally
// excluded from this table, matching that file's own established
// convention (Profile compatibility is verified separately) — Projects'
// own Profile rendering was verified via a direct real PDF-generation smoke
// check across all 7 templates including Profile (see §54's notebook
// entry), not re-duplicated here.
const TEMPLATES: Array<[TemplateId, ComponentType<{ content: CvContent }>]> = [
  ['classic', ClassicCvDocument],
  ['modern', ModernCvDocument],
  ['minimal', MinimalCvDocument],
  ['professional', ProfessionalCvDocument],
  ['compact', CompactCvDocument],
  ['signature', SignatureCvDocument],
];
// Deliberately does NOT contain the substring "project" anywhere in the
// name — the legacy-compatibility test below asserts the rendered
// text/HTML never mentions "projects" at all, so the fixture's own name
// must not accidentally satisfy that check by coincidence.
const LEGACY: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Compatibility QA Candidate', email: 'candidate@example.test' },
  summary: 'Software engineer building reliable applications.',
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};
const PROJECTS = [
  {
    id: 'proj-one',
    title: 'Muniverse Application',
    link: 'github.com/example/muniverse',
    startDate: '2023',
    endDate: '2024',
    bullets: ['Campus social media app.'],
  },
  { id: 'proj-two', title: 'Minimal Project', bullets: [] },
];

async function pdfText(content: CvContent, id: TemplateId) {
  const chunks: Buffer[] = [];
  const stream = new PdfGenerationService().generateStream(content, 'Compat QA', id);
  const data = await new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  const parser = new PDFParse({ data });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}
const compact = (value: string) => value.replace(/\s+/g, '');

describe.each(TEMPLATES)('Projects compatibility: %s', (id, Document) => {
  it('renders older CVs with no projects field in preview and PDF, and omits the Projects heading', async () => {
    const html = renderToStaticMarkup(createElement(Document, { content: LEGACY }));
    const pdf = await pdfText(LEGACY, id);
    expect(html).toContain('Compatibility QA Candidate');
    expect(compact(pdf.text)).toContain(compact('Compatibility QA Candidate'));
    expect(html.toLowerCase()).not.toContain('>projects<');
    expect(pdf.text.toLowerCase()).not.toContain('projects');
  });

  it('preserves every project field (title, link, dates, bullets) in preview and PDF', async () => {
    const content: CvContent = { ...LEGACY, projects: PROJECTS };
    const html = renderToStaticMarkup(createElement(Document, { content }));
    const pdf = await pdfText(content, id);
    for (const entry of PROJECTS) {
      expect(html).toContain(entry.title);
      expect(compact(pdf.text)).toContain(compact(entry.title));
      if (entry.link) {
        expect(html).toContain(entry.link);
        expect(compact(pdf.text)).toContain(compact(entry.link));
      }
      for (const bullet of entry.bullets) {
        expect(html).toContain(bullet);
        expect(compact(pdf.text)).toContain(compact(bullet));
      }
    }
  });

  it('retains every entry in a long multi-page Projects section', async () => {
    const projects = Array.from({ length: 14 }, (_, index) => ({
      id: 'long-' + index,
      title: 'Project Number ' + String(index).padStart(2, '0'),
      link: 'github.com/example/project-' + index,
      startDate: '2020',
      endDate: '2021',
      bullets: [
        'A fairly long description of what this project does and why it matters, ' +
          'written to occupy a realistic amount of vertical space on the page.',
      ],
    }));
    const content: CvContent = { ...LEGACY, projects };
    const html = renderToStaticMarkup(createElement(Document, { content }));
    const pdf = await pdfText(content, id);
    expect(pdf.pages.length).toBeGreaterThan(1);
    for (const entry of projects) {
      expect(html).toContain(entry.title);
      expect(compact(pdf.text)).toContain(compact(entry.title));
      expect(compact(pdf.text)).toContain(compact(entry.link));
    }
    expect(pdf.pages.every((page) => page.text.trim().length > 30)).toBe(true);
  });
});
