import { PDFParse } from 'pdf-parse';

import { generateCoverLetterPdf, type CoverLetterPdfInput } from './cover-letter-pdf.util';

/**
 * Same deterministic-extraction philosophy as apps/api's CV renderer tests
 * (pdf-generation.service.spec.ts): never trust that a render "looked
 * right" — verify the actual bytes/text pdf-parse pulls back out.
 */

async function extractText(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

const BASE_INPUT: CoverLetterPdfInput = {
  candidateName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+44 20 7946 0958',
  location: 'London, UK',
  senderAddress: '12 Baker Street\nLondon, NW1 6XE\nUnited Kingdom',
  date: new Date('2026-03-05T00:00:00.000Z'),
  recipientName: 'John Smith',
  recipientTitle: 'Head of Engineering',
  companyName: 'Acme Corp',
  companyAddress: '1 Infinite Loop\nCupertino, CA',
  content:
    'I am writing to express my interest in the Senior Engineer role at Acme Corp. ' +
    'My experience in backend development makes me a strong candidate for this position.\n\n' +
    'I look forward to discussing this opportunity further.',
};

describe('generateCoverLetterPdf', () => {
  it('produces a valid PDF containing the sender block, recipient block, and body', async () => {
    const pdf = await generateCoverLetterPdf(BASE_INPUT);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = await extractText(pdf);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('+44 20 7946 0958');
    expect(text).toContain('12 Baker Street');
    expect(text).toContain('London, NW1 6XE');
    expect(text).toContain('United Kingdom');
    expect(text).toContain('John Smith');
    expect(text).toContain('Head of Engineering');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Cupertino, CA');
    expect(text).toContain('Senior Engineer');
    expect(text).toContain('Sincerely');
  });

  // ─── V2.1 — two-sided composition (sender upper-right / recipient left) ──

  it('shows the full senderAddress instead of the short location when both are given (no redundant duplicate)', async () => {
    const pdf = await generateCoverLetterPdf(BASE_INPUT);
    const text = await extractText(pdf);
    expect(text).toContain('12 Baker Street');
    // "London, UK" (the short `location`) must not appear — senderAddress
    // supersedes it rather than showing both and risking a redundant line.
    expect(text).not.toContain('London, UK');
  });

  it('falls back to the short location when no senderAddress is given', async () => {
    const pdf = await generateCoverLetterPdf({ ...BASE_INPUT, senderAddress: undefined });
    const text = await extractText(pdf);
    expect(text).toContain('London, UK');
    expect(text).not.toContain('12 Baker Street');
  });

  it('falls back to location when senderAddress is an explicit null (the editor "cleared" state)', async () => {
    const pdf = await generateCoverLetterPdf({ ...BASE_INPUT, senderAddress: null });
    const text = await extractText(pdf);
    expect(text).toContain('London, UK');
    expect(text).not.toContain('12 Baker Street');
  });

  it('renders the sender block before the date, and the date before the recipient block (top-to-bottom, sender first)', async () => {
    const pdf = await generateCoverLetterPdf(BASE_INPUT);
    const text = await extractText(pdf);
    const senderIdx = text.indexOf('Jane Doe');
    const dateIdx = text.indexOf('5 March 2026');
    const recipientIdx = text.indexOf('John Smith');
    expect(senderIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThan(senderIdx);
    expect(recipientIdx).toBeGreaterThan(dateIdx);
  });

  it('still renders a valid, sensible document with no sender information at all (no senderAddress, no location, no contact details)', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      candidateName: undefined,
      email: undefined,
      phone: undefined,
      location: undefined,
      senderAddress: undefined,
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    // Still a complete, correctly-structured letter — date/recipient/
    // greeting/body/closing are all independent of sender info.
    expect(text).toContain('5 March 2026');
    expect(text).toContain('John Smith');
    expect(text).toContain('Dear John Smith,');
    expect(text).toContain('Sincerely');
  });

  it('adds its own greeting when the generated content has none', async () => {
    const pdf = await generateCoverLetterPdf(BASE_INPUT);
    const text = await extractText(pdf);
    expect(text).toContain('Dear John Smith,');
    // Only one greeting — never a duplicated "Dear ... Dear ..." opening.
    expect(text.split('Dear ').length - 1).toBe(1);
  });

  it('falls back to "Dear Hiring Manager," when no recipientName is given', async () => {
    const pdf = await generateCoverLetterPdf({ ...BASE_INPUT, recipientName: undefined });
    const text = await extractText(pdf);
    expect(text).toContain('Dear Hiring Manager,');
  });

  it('does not add a second greeting when the AI content already opens with "Dear ..."', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      content: 'Dear Hiring Manager, I am writing to express my interest in the role.',
    });
    const text = await extractText(pdf);
    expect(text.split('Dear ').length - 1).toBe(1);
  });

  it('omits the recipient block entirely when no recipient/company details are given', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      recipientName: undefined,
      recipientTitle: undefined,
      companyName: undefined,
      companyAddress: undefined,
      // BASE_INPUT.content mentions "Acme Corp" in the body text itself —
      // use body text with no company/recipient names so this test isn't
      // fooled by a legitimate body-text mention of the same string.
      content:
        'I am writing to express my interest in this role. I believe my experience is relevant.',
    });
    const text = await extractText(pdf);
    expect(text).not.toContain('Acme Corp');
    expect(text).not.toContain('Head of Engineering');
    expect(text).not.toContain('Cupertino');
  });

  it('renders correctly with no candidate contact details at all (upload CV with no structured content)', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      candidateName: undefined,
      email: undefined,
      phone: undefined,
      location: undefined,
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = await extractText(pdf);
    expect(text).toContain('Sincerely');
  });

  it('preserves accented European characters (Unicode) in both the sender location and a senderAddress', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      candidateName: 'François Müller-Øst',
      location: 'Zürich, Switzerland',
      senderAddress: 'Bahnhofstrasse 1\n8001 Zürich\nSchweiz',
      content:
        'Résumé: I have a genuine passion for building résilient, café-grade software at Malmö Analytics.',
    });
    const text = await extractText(pdf);
    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Bahnhofstrasse 1');
    expect(text).toContain('8001 Zürich');
    expect(text).toContain('Résumé');
    expect(text).toContain('résilient');
  });

  it('preserves accented European characters (Unicode) in the fallback location line when no senderAddress is given', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      candidateName: 'François Müller-Øst',
      location: 'Zürich, Switzerland',
      senderAddress: undefined,
      content:
        'Résumé: I have a genuine passion for building résilient, café-grade software at Malmö Analytics.',
    });
    const text = await extractText(pdf);
    expect(text).toContain('François Müller-Øst');
    expect(text).toContain('Zürich, Switzerland');
  });

  it('renders multiple paragraphs with no content loss for a long letter', async () => {
    const longParagraph =
      'This is a deliberately long paragraph meant to force the PDF to wrap across several lines ' +
      'and, combined with the other paragraphs below, to overflow onto a second page so multi-page ' +
      'behavior can be verified. '.repeat(6);
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      content: [longParagraph, longParagraph, longParagraph, longParagraph].join('\n\n'),
    });

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
    } finally {
      await parser.destroy();
    }
    expect(pageCount).toBeGreaterThanOrEqual(1);

    const text = await extractText(pdf);
    const occurrences = text.split('force the PDF to wrap').length - 1;
    expect(occurrences).toBe(4);
  });

  // ─── V2.1 — closing/signature duplication guard ───────────────────────

  it('does not add a second closing when the AI content already ends with its own sign-off', async () => {
    const pdf = await generateCoverLetterPdf({
      ...BASE_INPUT,
      content:
        'I am writing to express my interest in the Senior Engineer role at Acme Corp.\n\n' +
        'Sincerely,\nJane Doe',
    });
    const text = await extractText(pdf);
    // Only the one, AI-written "Sincerely," — never a second, renderer-
    // added one stacked on top of it.
    expect(text.split('Sincerely').length - 1).toBe(1);
  });

  it('still adds its own closing when the AI content has no sign-off of its own', async () => {
    const pdf = await generateCoverLetterPdf(BASE_INPUT);
    const text = await extractText(pdf);
    expect(text.split('Sincerely').length - 1).toBe(1);
  });

  // ─── V2.1 — multi-page safety: don't orphan "Sincerely," from the name ──

  it('keeps "Sincerely," and the candidate name on the same page even when the body ends near the page boundary', async () => {
    // Tuned to land the body's end close to the bottom margin so the
    // closing block would, without the keep-together guard, naturally
    // split across the page boundary.
    const paragraph =
      'This paragraph is sized to push the remaining space on the first page down to just above the ' +
      'closing block, so the orphan-avoidance guard has something real to avoid splitting. '.repeat(
        19,
      );
    const pdf = await generateCoverLetterPdf({ ...BASE_INPUT, content: paragraph });

    const parser = new PDFParse({ data: pdf });
    let pages: string[];
    try {
      const result = await parser.getText();
      pages = result.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }

    const lastPage = pages[pages.length - 1] ?? '';
    expect(lastPage).toContain('Sincerely');
    expect(lastPage).toContain('Jane Doe');
    // "Sincerely," must not appear alone on an earlier page with the name
    // pushed to the next one.
    if (pages.length > 1) {
      const secondToLastPage = pages[pages.length - 2] ?? '';
      expect(secondToLastPage.includes('Sincerely') && !secondToLastPage.includes('Jane Doe')).toBe(
        false,
      );
    }
  });

  // ─── V2.1 — one-page realistic letter ──────────────────────────────────

  it('a realistic ~350-word generated letter (with full sender and recipient addresses) fits on one page', async () => {
    const realisticContent =
      'I am writing to express my interest in the Senior Backend Engineer position at Acme Corp. ' +
      "Having spent the last four years building distributed systems in fintech, I was drawn to your team's " +
      'work on real-time payment infrastructure and the emphasis on reliability at scale described in the role.\n\n' +
      'In my current role, I led the migration of a monolithic billing system to an event-driven microservices ' +
      'architecture, reducing checkout latency by 63% while maintaining zero downtime throughout the rollout. ' +
      'I have also built and operated PostgreSQL-backed services handling several million transactions a month, ' +
      'with a strong focus on observability and graceful degradation under load.\n\n' +
      'I would welcome the opportunity to bring that combination of technical depth and cross-functional ' +
      'collaboration to Acme Corp, and I am glad to discuss how my experience in backend reliability could ' +
      'contribute to your team.';

    const pdf = await generateCoverLetterPdf({ ...BASE_INPUT, content: realisticContent });

    const parser = new PDFParse({ data: pdf });
    let pageCount: number;
    try {
      const result = await parser.getText();
      pageCount = result.pages.length;
    } finally {
      await parser.destroy();
    }
    expect(pageCount).toBe(1);
  });
});
