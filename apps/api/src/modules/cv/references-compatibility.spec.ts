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

const TEMPLATES: Array<[TemplateId, ComponentType<{ content: CvContent }>]> = [
  ['classic', ClassicCvDocument],
  ['modern', ModernCvDocument],
  ['minimal', MinimalCvDocument],
  ['professional', ProfessionalCvDocument],
  ['compact', CompactCvDocument],
  ['signature', SignatureCvDocument],
];
const LEGACY: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Reference QA Candidate', email: 'candidate@example.test' },
  summary: 'Software engineer building reliable applications.',
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};
const REFERENCES = [
  {
    id: 'ref-one',
    fullName: 'Alice Example',
    company: 'Example Research',
    jobTitle: 'Engineering Lead',
    email: 'alice@example.test',
    phone: '+32 123 456 789',
    relationship: 'Former Manager',
  },
  { id: 'ref-two', fullName: 'Bob Example' },
];

async function pdfText(content: CvContent, id: TemplateId) {
  const chunks: Buffer[] = [];
  const stream = new PdfGenerationService().generateStream(content, 'References QA', id);
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

describe.each(TEMPLATES)('References compatibility: %s', (id, Document) => {
  it('renders older CVs with no reference fields in preview and PDF', async () => {
    const html = renderToStaticMarkup(createElement(Document, { content: LEGACY }));
    const pdf = await pdfText(LEGACY, id);
    expect(html).toContain('Reference QA Candidate');
    expect(compact(pdf.text)).toContain(compact('Reference QA Candidate'));
    expect(html.toLowerCase()).not.toContain('>references<');
    expect(pdf.text.toLowerCase()).not.toContain('references');
  });

  it('preserves every reference field with the old section order in preview and PDF', async () => {
    const content: CvContent = { ...LEGACY, references: REFERENCES };
    const html = renderToStaticMarkup(createElement(Document, { content }));
    const pdf = await pdfText(content, id);
    for (const entry of REFERENCES) {
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id') continue;
        expect(html).toContain(value);
        expect(compact(pdf.text)).toContain(compact(value));
      }
    }
  });

  it('hides details on request and restores them without mutating the saved model', async () => {
    const content: CvContent = {
      ...LEGACY,
      references: structuredClone(REFERENCES),
      referencesAvailableUponRequest: true,
    };
    const before = JSON.stringify(content);
    const html = renderToStaticMarkup(createElement(Document, { content }));
    const pdf = await pdfText(content, id);
    expect(compact(html)).toContain(compact('References available upon request.'));
    expect(compact(pdf.text)).toContain(compact('References available upon request.'));
    for (const hidden of ['Alice Example', 'Bob Example', 'alice@example.test']) {
      expect(html).not.toContain(hidden);
      expect(pdf.text).not.toContain(hidden);
    }
    expect(JSON.stringify(content)).toBe(before);
    const restored: CvContent = { ...content, referencesAvailableUponRequest: false };
    expect(renderToStaticMarkup(createElement(Document, { content: restored }))).toContain(
      'Alice Example',
    );
    expect((await pdfText(restored, id)).text).toContain('Alice Example');
  });

  it('retains every entry in a long multi-page References section', async () => {
    const references = Array.from({ length: 16 }, (_, index) => ({
      id: 'long-' + index,
      fullName: 'Reference Person Number ' + String(index).padStart(2, '0'),
      jobTitle: 'Senior Engineering and Research Programme Supervisor',
      company: 'International Research and Technology Collaboration Department',
      relationship: 'Professional supervisor and technical project mentor',
      email: 'reference.person.' + index + '@research.example.test',
      phone: '+32 123 456 789 extension ' + index,
    }));
    const content: CvContent = { ...LEGACY, references };
    const html = renderToStaticMarkup(createElement(Document, { content }));
    const pdf = await pdfText(content, id);
    expect(pdf.pages.length).toBeGreaterThan(1);
    for (const entry of references) {
      expect(html).toContain(entry.fullName);
      expect(compact(pdf.text)).toContain(compact(entry.fullName));
      expect(compact(pdf.text)).toContain(compact(entry.email));
    }
    expect(pdf.pages.every((page) => page.text.trim().length > 30)).toBe(true);
  });
});
